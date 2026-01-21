## Cloudflare Tunnel (no router access)

Use this if you cannot port-forward 80/443 from your home network.

### Goal

- Publish `api.chat.errl.wtf` -> `http://127.0.0.1:3033` (chat-api) via a Cloudflare Tunnel.
- Keep `chat-api` bound to localhost on the server.

### Steps (high level)

- Zero Trust -> Networks -> Tunnels -> create/select a tunnel
- Add a *published application route* (public hostname):
  - Hostname: `api.chat.errl.wtf`
  - Service: `http://127.0.0.1:3033`
- Run the connector on the server (docker recommended).

### Important notes

- Do not keep an `A` record for `api.chat` pointing to a home IP when using Tunnel; the tunnel creates the correct DNS record.
- Connector tokens are secrets. If a token is pasted into chat/logs, rotate it.

