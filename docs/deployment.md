# Deployment

Use an always-on Linux Docker host with at least 4 GB RAM (Elasticsearch is the largest consumer). Only Caddy publishes ports; PostgreSQL, Redis and Elasticsearch remain on the private Compose network.

## Production configuration

1. Point `APP_DOMAIN` DNS at the host. Copy `.env.example` to `.env` and use service hosts in connection strings:
   - `DATABASE_URL=postgresql://reachinbox:<encoded password>@postgres:5432/reachinbox?schema=public`
   - `REDIS_URL=redis://redis:6379`
   - `ELASTICSEARCH_URL=http://elasticsearch:9200`
   - `WEB_ORIGIN=https://mail.example.com`
   - `PUBLIC_ORIGIN=https://mail.example.com`
   - `TRUST_PROXY=true`
2. Generate independent session/encryption secrets with `openssl rand -base64 32`. Add `POSTGRES_PASSWORD` and `APP_DOMAIN`.
3. Configure the exact Google callback `https://mail.example.com/api/auth/google/callback` and authorized origin `https://mail.example.com`.
4. Configure the exact Slack callback `https://mail.example.com/api/integrations/slack/callback`, enable OAuth, and request `incoming-webhook`.
5. Set `ADMIN_EMAILS` to the reviewer's Google email.

## Deploy/update

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis elasticsearch
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml run --rm api npm run search:setup
docker compose -f docker-compose.prod.yml run --rm api npm run db:seed:senders
docker compose -f docker-compose.prod.yml up -d api worker caddy
```

The API and worker are separate services with `unless-stopped`, so either may be restarted independently. Named volumes preserve all three data services. Caddy provisions and renews HTTPS automatically.

## Smoke tests

```bash
curl -fsS https://mail.example.com/health/live
curl -i https://mail.example.com/health/ready
docker compose -f docker-compose.prod.yml exec worker node -e "require('net').connect(587,'smtp.ethereal.email').once('connect',function(){console.log('SMTP reachable');this.end()}).once('error',e=>{console.error(e);process.exit(1)})"
docker compose -f docker-compose.prod.yml logs --tail=100 api worker
```

Then perform one real Google login, connect a real Slack workspace/channel, schedule three safe addresses with sender cap 2, and retain the Ethereal preview and Slack message as evidence. These credentialed checks cannot be automated in CI.
