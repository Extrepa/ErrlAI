## Homepage (internal dashboard) integration

You already have Homepage running (e.g. `http://192.168.68.62:3000/`) and Ollama reachable (`:11434`).

Suggested additions:

### services.yaml snippet

```yaml
- AI:
    - ErrlAI Chat:
        href: https://chat.errl.wtf
        description: chat.errl.wtf (Cloudflare Pages)
        icon: si-openai
    - ErrlAI API:
        href: https://api.chat.errl.wtf/health
        description: Ollama proxy (requires Access)
        icon: si-node-dot-js
```

Notes:
- If Homepage can’t pass Cloudflare Access, keep the API entry as a plain link or point it at the LAN-only URL if you expose one.
