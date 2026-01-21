import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();

const PORT = Number(process.env.PORT || 3033);

// Ollama (local)
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'errl-ai';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120_000);

// Keep local models snappy on low-RAM servers
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 1024);
const OLLAMA_NUM_PREDICT = Number(process.env.OLLAMA_NUM_PREDICT || 128);

// Gemini (cloud) - backend only
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '');
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-2.0-flash');
const GEMINI_API_BASE = String(process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta');
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || OLLAMA_TIMEOUT_MS);

// Rate limiting (per IP)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);

const rateLimitBuckets = new Map();

function withTimeout(controller, ms) {
  const t = setTimeout(() => controller.abort(), ms);
  return () => clearTimeout(t);
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp) return cfIp;

  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();

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
    res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'rate limit exceeded' });
  }

  if (rateLimitBuckets.size > 5000) {
    for (const [k, v] of rateLimitBuckets.entries()) {
      if (now > v.resetAt) rateLimitBuckets.delete(k);
    }
  }

  next();
}

function getOllamaOptions() {
  const options = {};
  if (Number.isFinite(OLLAMA_NUM_CTX) && OLLAMA_NUM_CTX > 0) options.num_ctx = OLLAMA_NUM_CTX;
  if (Number.isFinite(OLLAMA_NUM_PREDICT) && OLLAMA_NUM_PREDICT > 0) options.num_predict = OLLAMA_NUM_PREDICT;
  return options;
}

function isGeminiModelName(name) {
  return typeof name === 'string' && name.startsWith('gemini:');
}

function stripGeminiPrefix(name) {
  return name.replace(/^gemini:/, "") || GEMINI_MODEL;
}

async function fetchOllamaTags(signal) {
  const r = await fetch(`${OLLAMA_HOST}/api/tags`, { signal });
  if (!r.ok) throw new Error(`ollama /api/tags failed: ${r.status}`);
  return await r.json();
}

async function geminiGenerate({ model, messages, signal }) {
  const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: Number.isFinite(OLLAMA_NUM_PREDICT) ? OLLAMA_NUM_PREDICT : 256,
    },
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`gemini upstream failed: ${r.status}${t ? `: ${t.slice(0, 500)}` : ""}`);
  }

  const j = await r.json();
  const parts = j.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || '').join('');
  return { raw: j, content: text };
}

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
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
  res.json({ ok: true, service: "chat-api", ollamaHost: OLLAMA_HOST });
});

app.get('/v1/models', async (req, res) => {
  const controller = new AbortController();
  const clear = withTimeout(controller, OLLAMA_TIMEOUT_MS);
  try {
    const j = await fetchOllamaTags(controller.signal);
    const models = (j.models || []).map((m) => ({ name: m.name }));

    if (GEMINI_API_KEY) {
      models.unshift({ name: `gemini:${GEMINI_MODEL}` });
    }

    res.json({ models, default: DEFAULT_MODEL });
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  } finally {
    clear();
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

  // Gemini branch (backend-only). Use a gemini: prefix in the model name.
  if (isGeminiModelName(useModel)) {
    if (!GEMINI_API_KEY) {
      return res.status(502).json({ error: 'gemini not configured (missing GEMINI_API_KEY)' });
    }

    const controller = new AbortController();
    const clear = withTimeout(controller, GEMINI_TIMEOUT_MS);
    req.on("close", () => controller.abort());

    try {
      const geminiModel = stripGeminiPrefix(useModel);
      const { content, raw } = await geminiGenerate({ model: geminiModel, messages, signal: controller.signal });

      if (!doStream) {
        return res.json({ model: useModel, content, raw });
      }

      // "Streaming" response: send one token chunk and finish.
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const sendSse = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendSse('meta', { model: useModel });
      if (content) sendSse('token', { token: content });
      sendSse('done', { done: true });
      return res.end();
    } catch (e) {
      return res.status(502).json({ error: String(e?.message || e) });
    } finally {
      clear();
    }
  }

  // Ollama branch
  const controller = new AbortController();
  const clear = withTimeout(controller, OLLAMA_TIMEOUT_MS);
  req.on("close", () => controller.abort());

  const options = getOllamaOptions();

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
        body: JSON.stringify({ model: useModel, messages, stream: false, options }),
      });

      if (upstream.status === 404) {
        const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
        upstream = await fetch(`${OLLAMA_HOST}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ model: useModel, prompt, stream: false, options }),
        });
      }

      if (!upstream.ok) {
        return res.status(502).json({ error: `ollama upstream failed: ${upstream.status}` });
      }

      const j = await upstream.json();
      const content = j.message?.content ?? j.response ?? '';
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
      try {
        res.write(':ping\n\n');
      } catch {}
    }, 15_000);
    req.on("close", () => clearInterval(heartbeat));

    sendSse('meta', { model: useModel });

    let upstream = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model: useModel, messages, stream: true, options }),
    });

    if (upstream.status === 404) {
      const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
      upstream = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model: useModel, prompt, stream: true, options }),
      });
    }

    if (!upstream.ok || !upstream.body) {
      sendSse("error", { error: `ollama upstream failed: ${upstream.status}` });
      clearInterval(heartbeat);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const chunkLines = buf.split("\n");
      buf = chunkLines.pop() || '';

      for (const line of chunkLines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t);
          const token = j.message?.content ?? j.response ?? '';
          const doneFlag = !!j.done;
          if (token) sendSse('token', { token });
          if (doneFlag) sendSse('done', { done: true });
        } catch {
          // ignore parse errors
        }
      }
    }

    clearInterval(heartbeat);
    res.end();
  } catch (e) {
    if (String(e?.name || '').includes('Abort')) return;
    try {
      if (!res.headersSent) return res.status(502).json({ error: String(e?.message || e) });
      sendSse("error", { error: String(e?.message || e) });
      res.end();
    } catch {}
  } finally {
    clear();
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`chat-api listening on http://127.0.0.1:${PORT}`);
});
