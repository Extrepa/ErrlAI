## Cloudflare Access

Goal: require login for both:
- `chat.errl.wtf/*`
- `api.chat.errl.wtf/*`

Recommended:
- Create ONE wildcard self-hosted app for `*.chat.errl.wtf` (covers both `chat.errl.wtf` and `api.chat.errl.wtf`)
- Restrict to your identity / allowed emails

Notes:
- With Access in front, the API does not need a public API key.
- Keep the API bound to localhost on the server; Caddy exposes it only via the hostname.
