## Cloudflare Pages (chat.errl.wtf)

Goal: host the frontend (`apps/chat-web`) on Cloudflare Pages with custom domain `chat.errl.wtf`.

Suggested settings:
- Root directory: `apps/chat-web`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Environment variables:
  - `VITE_API_BASE=https://api.chat.errl.wtf`

Then add custom domain:
- `chat.errl.wtf` -> this Pages project
