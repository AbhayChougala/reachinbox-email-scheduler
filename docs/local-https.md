# Local HTTPS OAuth testing

This setup exposes only Vite. Vite serves the frontend and proxies `/api`, `/admin`, and `/health` to the local API, so the browser sees one HTTPS origin and one host-only session cookie.

## 1. Start a quick tunnel

Install Cloudflare Tunnel once on macOS:

```bash
brew install cloudflared
```

Keep terminal 1 running:

```bash
cloudflared tunnel --url http://localhost:5173
```

Copy the generated `https://<random>.trycloudflare.com` URL. Quick Tunnel hostnames change when restarted.

## 2. Register callbacks

For public origin `https://<host>`:

- Slack redirect: `https://<host>/api/integrations/slack/callback`
- Additional Google redirect: `https://<host>/api/auth/google/callback`

Keep the existing localhost Google callback registered.

## 3. Start the application with the guarded launcher

Do not edit or replace `.env`. Keep terminal 2 running and substitute the same generated origin:

```bash
DEV_HTTPS_ORIGIN=https://<host> npm run dev:https
```

The launcher refuses to start if ports 5173 or 4000 are occupied, explicitly loads API/worker secrets from the repository-root `.env`, and derives every non-secret origin/callback setting from the one public origin. It removes inherited Slack credential variables only for the child processes so stale shell exports cannot override the root `.env`; it does not alter Google credentials or the `.env` file.

Open only `https://<host>` for this test. Do not mix localhost and tunnel tabs during an OAuth flow because cookies are host-scoped. The API trusts the local Vite proxy, Vite supplies the HTTPS forwarding headers, and the API issues an HttpOnly, Secure, SameSite=Lax session cookie suitable for top-level OAuth redirects.

If the tunnel restarts with a different hostname, update both provider redirect URIs and every override above before starting a new OAuth flow.
