import React, { useEffect, useMemo, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant' | 'system'; content: string };
type TokenEvent = { token: string };
type ModelsResponse = { models: { name: string }[]; default?: string };

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3033';

export function App() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'system',
      content:
        'This chat runs via Ollama through a private API. It cannot access vault/server tools from the website.',
    },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<'unknown' | 'ok' | 'down'>('unknown');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>('');

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/health`);
        setStatus(r.ok ? 'ok' : 'down');
      } catch {
        setStatus('down');
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/v1/models`);
        if (!r.ok) return;
        const j = (await r.json()) as ModelsResponse;
        const list = (j.models || []).map((m) => m.name);
        setModels(list);
        if (!model) setModel(j.default || list[0] || "");
      } catch {
        // ignore
      }
    })();
  }, []);

  const chatMessages = useMemo(() => messages.filter((m) => m.role !== "system"), [messages]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const next: Msg[] = [...messages, { role: "user", content: trimmed }, { role: "assistant", content: "" }];
    setMessages(next);
    setInput("");
    setStreaming(true);

    try {
      const res = await fetch(`${API_BASE}/v1/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: model || undefined,
          messages: chatMessages.concat({ role: "user", content: trimmed }),
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`API failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const parts = buf.split("\n\n");
        buf = parts.pop() || "";

        for (const part of parts) {
          const lines = part.split("\n").map((l) => l.trim());
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          const event = eventLine ? eventLine.replace("event:", "").trim() : "";
          const data = dataLine ? dataLine.replace("data:", "").trim() : "";
          if (!event || !data) continue;

          if (event === "token") {
            const j = JSON.parse(data) as TokenEvent;
            const token = j.token || "";
            if (!token) continue;
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: last.content + token };
              }
              return copy;
            });
          }

          if (event === "error") {
            const j = JSON.parse(data) as { error: string };
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: `Error: ${j.error}` };
              }
              return copy;
            });
          }
        }
      }
    } catch (e: any) {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = { ...last, content: `Error: ${String(e?.message || e)}` };
        }
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>ErrlAI Chat</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>API: {status}</span>
          {models.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </header>

      <p style={{ fontSize: 12, opacity: 0.75 }}>
        This website chat is Ollama-direct via a private API. It cannot access vault/server tools from the website.
      </p>

      <main style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, minHeight: 320 }}>
        {messages
          .filter((m) => m.role !== "system")
          .map((m, idx) => (
            <div key={idx} style={{ margin: "10px 0" }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{m.role}</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
            </div>
          ))}
        <div ref={bottomRef} />
      </main>

      <footer style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          value={input}
          placeholder={streaming ? "Streaming..." : "Type a message"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={streaming}
        />
        <button onClick={send} disabled={streaming || !input.trim()}>
          Send
        </button>
      </footer>
    </div>
  );
}
