## Deployment overview

Intended run mode:

- `chat.errl.wtf`: Cloudflare Pages -> `apps/chat-web`
- `api.chat.errl.wtf`: Caddy -> localhost `chat-api` -> Ollama
- Auth: Cloudflare Access

See:
- `docs/cloudflare-pages.md`
- `docs/cloudflare-access.md`
- `docs/caddy.md`
- `docs/server-runbook.md`
- `docs/cloudflare-tunnel.md`
