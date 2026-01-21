## Cloudflare Access

Goal: require login for both:
- `chat.errl.wtf/*`
- `api.errl.wtf/*`

Recommended:

Option A (simplest): two apps
- `chat.errl.wtf/*`
- `api.errl.wtf/*`

Option B: one wildcard app
- `*.errl.wtf/*` (covers both, but also covers any other one-level subdomains)

Notes:
- With Access in front, the API does not need a public API key.
- Keep the API bound to localhost on the server; Caddy exposes it only via the hostname.
