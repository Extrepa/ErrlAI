import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();

const PORT = Number(process.env.PORT || 3033);
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'errl-ai';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120_000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);

const rateLimitBuckets = new Map();

function withTimeout(controller) {
  const t = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  return () => clearTimeout(t);
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === "string" && cfIp) return cfIp;

  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();

  return req.ip || 'unknown';
}

function rateLimit(req, res, next) {
  if (RATE_LIMIT_MAX <= 0 || RATE_LIMIT_WINDOW_MS <= 0) return next();

  const now = Date.now();
  const ip = getClientIp(req);

  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { resetAt: now + RATE_LIMIT_WINDOW_MS, count: 0 };
    rateLimitBuckets.set(ip, bucket);
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'rate limit exceeded' });
  }

  if (rateLimitBuckets.size > 5000) {
    for (const [k, v] of rateLimitBuckets.entries()) {
      if (now > v.resetAt) rateLimitBuckets.delete(k);
    }
  }

  next();
}

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, false);
      return cb(null, allowedOrigins.includes(origin));
    },
  })
);

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'chat-api',
    endpoints: { health: '/health', models: '/v1/models', chat: '/v1/chat' },
  });
});
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'chat-api', ollamaHost: OLLAMA_HOST });
});

app.get('/v1/models', async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!r.ok) return res.status(502).json({ error: `ollama /api/tags failed: ${r.status}` });
    const j = await r.json();
    const models = (j.models || []).map((m) => ({ name: m.name }));
    res.json({ models, default: DEFAULT_MODEL });
  } catch (e) {
    try { clearTimeoutFn(); } catch {}
    res.status(502).json({ error: String(e?.message || e) });
  }
});

// SSE streaming chat proxy. Uses Ollama /api/chat when available; falls back to /api/generate.
app.post('/v1/chat', rateLimit, async (req, res) => {
  const { model, messages, stream = true } = req.body || {};
  const useModel = model || DEFAULT_MODEL;
  const doStream = stream !== false;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const controller = new AbortController();
  const clearTimeoutFn = withTimeout(controller);
  req.on('close', () => controller.abort());

  const sendSse = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    if (!doStream) {
      // Non-stream JSON response
      let upstream = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model: useModel, messages, stream: false }),
      });

      if (upstream.status === 404) {
        const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
        upstream = await fetch(`${OLLAMA_HOST}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ model: useModel, prompt, stream: false }),
        });
      }

      clearTimeoutFn();
      if (!upstream.ok) {
        return res.status(502).json({ error: `ollama upstream failed: ${upstream.status}` });
      }

      clearTimeoutFn();
      const j = await upstream.json();
      const content = j.message?.content ?? j.response ?? "";
      return res.json({ model: useModel, content, raw: j });
    }

    // Streaming SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Heartbeat to keep some proxies from closing the stream
    const heartbeat = setInterval(() => {
      try { res.write(":ping\n\n"); } catch {}
    }, 15_000);
    req.on('close', () => clearInterval(heartbeat));

    sendSse("meta", { model: useModel });

    let upstream = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model: useModel, messages, stream: true }),
    });

    if (upstream.status === 404) {
      const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
      upstream = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model: useModel, prompt, stream: true }),
      });
    }

    clearTimeoutFn();
    if (!upstream.ok || !upstream.body) {
      sendSse("error", { error: `ollama upstream failed: ${upstream.status}` });
      clearInterval(heartbeat);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t);
          const token = j.message?.content ?? j.response ?? "";
          const doneFlag = !!j.done;
          if (token) sendSse("token", { token });
          if (doneFlag) sendSse("done", { done: true });
        } catch {
          // ignore parse errors
        }
      }
    }

    clearTimeoutFn();

    clearInterval(heartbeat);
    res.end();
  } catch (e) {
    // If the client disconnected, abort is expected
    if (String(e?.name || "").includes("Abort")) return;
    try {
      if (!res.headersSent) return res.status(502).json({ error: String(e?.message || e) });
      sendSse("error", { error: String(e?.message || e) });
      res.end();
    } catch {}
  }
});
app.listen(PORT, "127.0.0.1", () => {
  console.log(`chat-api listening on http://127.0.0.1:${PORT}`);
});
