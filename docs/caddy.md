## Caddy (api.chat.errl.wtf)

Goal: expose the chat API via Caddy while keeping the service localhost-bound.

Example Caddy site block:

```
api.chat.errl.wtf {
  reverse_proxy 127.0.0.1:3033
}
```

Gate `api.chat.errl.wtf/*` with Cloudflare Access.
