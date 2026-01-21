## ErrlAI (chat.errl.wtf)

Fullstack chat app for `chat.errl.wtf`.

- Frontend: Cloudflare Pages (`chat.errl.wtf`)
- Backend: Node/Express API on your server, localhost-bound, proxied via Caddy (`api.chat.errl.wtf`)
- Inference: Ollama on server (`http://127.0.0.1:11434`)
- Auth: Cloudflare Access in front of both hostnames

### Repo layout

- `apps/chat-web/` - Vite + React + TS
- `apps/chat-api/` - Node + Express (Ollama proxy)

### Local dev (two terminals)

Terminal A (API):

```bash
cd apps/chat-api
cp .env.example .env
npm install
npm run dev
```

Terminal B (Web):

```bash
cd apps/chat-web
cp .env.example .env
npm install
npm run dev
```

### Deployment (high level)

- Deploy `apps/chat-web` to Cloudflare Pages (custom domain `chat.errl.wtf`)
- Run `apps/chat-api` on the server (systemd or docker)
- Caddy proxies `api.chat.errl.wtf` -> `127.0.0.1:3033`
- Cloudflare Access gates both `chat.errl.wtf/*` and `api.chat.errl.wtf/*`
