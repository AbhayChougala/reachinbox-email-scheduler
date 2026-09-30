# Deployment

Use an always-on Linux Docker host with at least 4 GB RAM; Elasticsearch is the largest consumer. Only Caddy publishes host ports. PostgreSQL, Redis, Elasticsearch, the API, and the worker stay on the private Compose network.

No production host, domain, DNS zone, or deployment credential is configured in this repository. The `trycloudflare.com` URL used during evaluation is an accountless tunnel into the developer laptop, has no uptime guarantee, and is not an independent deployment.

## Minimum deployment inputs still required

- An always-on Linux host with Docker Engine and Compose, at least 4 GB RAM, and persistent disk.
- A public domain or subdomain plus permission to create its DNS record pointing to the host.
- Inbound TCP 80/443 and outbound HTTPS and SMTP (normally TCP 587) permitted by the host/provider.
- The production domain to place in `APP_DOMAIN` and register with Google and Slack.
- A decision about which Google accounts belong in `ADMIN_EMAILS`.

No resource purchase is required by the repository and none has been attempted.

## Production environment checklist

Keep the production `.env` only on the host and out of Git. Set:

- `NODE_ENV=production`, `PORT=4000`, `APP_DOMAIN=<public hostname>`, and a long random `POSTGRES_PASSWORD`.
- `WEB_ORIGIN=https://<APP_DOMAIN>`, `PUBLIC_ORIGIN=https://<APP_DOMAIN>`, and `TRUST_PROXY=true`.
- `DATABASE_URL=postgresql://reachinbox:<URL-encoded POSTGRES_PASSWORD>@postgres:5432/reachinbox?schema=public`.
- `REDIS_URL=redis://redis:6379`, `ELASTICSEARCH_URL=http://elasticsearch:9200`, and the desired `ELASTICSEARCH_INDEX`.
- Independent high-entropy `SESSION_SECRET` and 32-byte base64 `INTEGRATION_ENCRYPTION_KEY`. Back them up; changing the encryption key makes stored integration/SMTP credentials unreadable.
- Existing Google client ID/secret with redirect `https://<APP_DOMAIN>/api/auth/google/callback`. This server-side implementation does not require an Authorized JavaScript origin.
- Existing Slack client ID/secret with redirect `https://<APP_DOMAIN>/api/integrations/slack/callback` and only `incoming-webhook` scope.
- `ADMIN_EMAILS` with the exact Google account(s) allowed to open Bull Board. Review worker concurrency, retry, batch, and sender defaults rather than relying on example values blindly.

Do not copy an existing local `.env` over production or rotate encryption/session values during routine deploys. Keep the production file readable only by the deployment account (for example, `chmod 600 .env`). Do not paste secret values into Compose, shell history, CI logs, screenshots, or Git; the committed `.env.example` contains names and placeholders only.

## First deploy

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis elasticsearch
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml run --rm api npm run search:setup
docker compose -f docker-compose.prod.yml run --rm api npm run db:seed:senders
docker compose -f docker-compose.prod.yml up -d api worker caddy
```

Point the production DNS record at the host before starting Caddy so it can obtain the certificate. The API serves the built React application and API routes from one origin; Caddy is the only public entry point. `TRUST_PROXY=true` lets Express honor Caddy's HTTPS forwarding, while the session cookie remains host-only, HttpOnly, SameSite=Lax, and Secure.

Run sender provisioning only when new Ethereal accounts are intentionally required. Routine deploys use:

```bash
docker compose -f docker-compose.prod.yml build api worker
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d --no-deps api worker
```

The API and worker can be restarted independently:

```bash
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml restart worker
```

Named volumes preserve PostgreSQL, Redis AOF, Elasticsearch, and Caddy state. Caddy provisions and renews HTTPS and serves the built frontend/API from one origin.

## Post-deploy verification

```bash
curl -fsS https://<APP_DOMAIN>/health/live
curl -fsS https://<APP_DOMAIN>/health/ready
docker compose -f docker-compose.prod.yml exec worker node -e "require('net').connect(587,'smtp.ethereal.email').once('connect',function(){console.log('SMTP reachable');this.end()}).once('error',e=>{console.error(e);process.exit(1)})"
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 api worker caddy
```

`docker compose ps` must show PostgreSQL, Redis, Elasticsearch, API, and worker healthy before OAuth or SMTP checks. Apply migrations on every release before replacing API/worker containers. A routine rollback should deploy the prior image without deleting volumes or rotating `SESSION_SECRET`/`INTEGRATION_ENCRYPTION_KEY`.

Then perform one real Google login, authorize Slack to the selected test channel, send one Ethereal message, verify its preview, verify search, and confirm `/admin/queues` returns `403` to a signed-in non-admin. Verify from the host firewall or another machine that database port 5432, Redis 6379, Elasticsearch 9200, and API 4000 are not publicly reachable.

Back up the PostgreSQL and Redis volumes and the production environment secrets. Elasticsearch can be rebuilt from PostgreSQL with `npm run search:reindex`, but PostgreSQL, the encryption key, and the durable SMTP/Slack credentials it protects are authoritative.
