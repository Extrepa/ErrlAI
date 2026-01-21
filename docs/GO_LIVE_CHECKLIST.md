## Go-live checklist (chat.errl.wtf)

### API (server)

- [ ] Ollama is healthy: `http://127.0.0.1:11434` returns 200
- [ ] `apps/chat-api` is running on localhost: `http://127.0.0.1:3033/health`
- [ ] Caddy reverse proxy for `api.errl.wtf` -> `127.0.0.1:3033`
- [ ] Cloudflare Access protects `api.errl.wtf/*`

### Web (Cloudflare Pages)

- [ ] Pages project root: `apps/chat-web`
- [ ] Build: `npm ci && npm run build`
- [ ] Output: `dist`
- [ ] Env: `VITE_API_BASE=https://api.errl.wtf`
- [ ] Custom domain: `chat.errl.wtf`
- [ ] Cloudflare Access protects `chat.errl.wtf/*`

### UX sanity

- [ ] `/v1/models` returns expected models
- [ ] Streaming works end-to-end (first token after model warm-up)
- [ ] Disclaimer copy is visible (no vault/server tool access from browser)
