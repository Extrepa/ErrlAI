## Server runbook (api.chat.errl.wtf)

Goal: run `apps/chat-api` on the server (localhost-only), then expose it via Caddy at `api.chat.errl.wtf` and protect it with Cloudflare Access.

### Prereqs

- Ollama running on the server (default: `http://127.0.0.1:11434`)
- This repo present on the server (or deployed artifact)
- Node.js installed on the server

### Configure env

Copy the example and edit:

```bash
cd /path/to/ErrlAI/apps/chat-api
cp .env.example .env
```

Suggested production values:
- `PORT=3033`
- `OLLAMA_HOST=http://127.0.0.1:11434`
- `DEFAULT_MODEL=errl-ai` (or whatever you build in Ollama)
- `ALLOWED_ORIGINS=https://chat.errl.wtf`
- `RATE_LIMIT_WINDOW_MS=60000`, `RATE_LIMIT_MAX=30`

### Run with systemd (recommended)

Use `docs/systemd/chat-api.service` as a template.

```bash
sudo cp docs/systemd/chat-api.service /etc/systemd/system/chat-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now chat-api
sudo systemctl status chat-api
```

### Caddy

Add a site block like:

```
api.chat.errl.wtf {
  reverse_proxy 127.0.0.1:3033
}
```
