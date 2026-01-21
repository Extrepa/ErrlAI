## Caddy (optional)

Goal: optional local reverse proxy. If you are using Cloudflare Tunnel directly to `http://127.0.0.1:3033`, you do not need Caddy for the API.

Example Caddy site block:

```
api.errl.wtf {
  reverse_proxy 127.0.0.1:3033
}
```

Gate `api.errl.wtf/*` with Cloudflare Access.


Note: with Tunnel, publish `api.errl.wtf` -> `http://127.0.0.1:3033`.
