# ReachInbox email scheduler

A full-stack, owner-scoped email scheduling application for the Outbox Labs hiring assignment. It commits campaigns to PostgreSQL, recovers queue publication through a transactional outbox, schedules one durable BullMQ job per recipient, enforces sender-wide limits atomically in Redis, sends through persistent Ethereal accounts, indexes state in Elasticsearch, and notifies Slack when a sender reaches its real UTC-hour cap.

## What runs where

| Service | Responsibility |
| --- | --- |
| `apps/web` | React/Vite/Tailwind dashboard, CSV parsing, explicit local-time conversion |
| `apps/api` | Google OIDC, sessions, tenancy, campaign transactions, outbox dispatch, Slack OAuth, search and Bull Board |
| `apps/worker` | BullMQ SMTP, rate admission, Slack notification and Elasticsearch indexing workers |
| `packages/shared` | Configuration, Prisma client, encryption, validation, queue names and Redis Lua admission |
| PostgreSQL | Authoritative users, senders, campaigns, messages, attempts, idempotency and outbox |
| Redis | Persistent BullMQ state plus atomic sender/campaign counters |
| Elasticsearch | Eventually consistent owner-filtered dashboard search |

The detailed lifecycle and failure model are in [docs/architecture.md](docs/architecture.md). The API definition is importable from [docs/api.openapi.yaml](docs/api.openapi.yaml).

## Local setup

Requirements: Node 22+, npm 12+, Docker Desktop/Engine with Compose, and network access to Google, Slack and Ethereal for live integration checks.

```bash
cp .env.example .env
openssl rand -base64 32   # SESSION_SECRET (use 32+ characters)
openssl rand -base64 32   # INTEGRATION_ENCRYPTION_KEY (base64 value must decode to 32 bytes)
npm install
docker compose up -d postgres redis elasticsearch
npm run db:generate
npm run db:migrate
npm run search:setup
```

Create OAuth applications before login:

- Google Cloud web client callback: `http://localhost:4000/api/auth/google/callback`; origin: `http://localhost:5173`.
- Slack app callback: `http://localhost:4000/api/integrations/slack/callback`; add `incoming-webhook` scope and enable OAuth.

Set `PROVISION_OWNER_EMAIL` to the same Google email, then create exactly two durable Ethereal accounts (the generated passwords are AES-GCM encrypted before storage):

```bash
npm run db:seed:senders
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:4000`. A user listed in `ADMIN_EMAILS` can open `http://localhost:4000/admin/queues` after Google login.

The provisioning script is explicit and repeatable, but Ethereal returns new accounts when rerun. Accounts are never recreated by normal API/worker restarts.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration   # requires the three Docker services and applied migration
npm run build
npm audit --audit-level=moderate
curl -i http://localhost:4000/health/live
curl -i http://localhost:4000/health/ready
```

Current local results at handoff are recorded in the final section below, separating automated/mock coverage from credentialed checks.

## Operating behavior worth explaining

- The `Idempotency-Key` is unique per owner and tied to a stable payload fingerprint. Reuse with different content returns `409`; identical replay returns the original campaign.
- Recipient deduplication applies only inside one upload. A later campaign may intentionally email the same recipient.
- Message times are stored as UTC. The browser sends both an ISO instant and its IANA timezone, so `datetime-local` is never silently treated as UTC.
- A campaign limit may tighten its sender. It cannot loosen the sender's shared cap or spacing. Fixed windows are UTC clock hours.
- The worker never sleeps for throttling. It atomically asks Redis for admission and moves denied work to a delayed time, preserving SMTP retry attempts and freeing concurrency for other senders.
- Reaching the last allowed sender slot creates one PostgreSQL notification event for `(owner, sender, UTC hour)`. Slack delivery retries independently and never retries an email.
- Elasticsearch outages do not stop sending. The UI shows an explicit search error, and `npm run search:reindex` rebuilds the index in bounded pages.
- Confirmed `SENT` rows are terminal. A stale SMTP claim becomes `AMBIGUOUS` because a crash after server acceptance cannot be safely distinguished from non-delivery.

## Real-integration smoke checks

Google, Slack and Ethereal require credentials and user consent; automated tests use no fake feature in place of them.

1. Sign in through Google and confirm `/api/me` returns only your profile.
2. Run the two-sender provisioning script and confirm no password appears in `/api/senders` or browser network responses.
3. Connect Slack, choose a channel, set one sender cap to 2, and schedule `sample-leads.csv` (3 rows). Confirm exactly one threshold message and a third email delayed to the next actual UTC hour.
4. Open each confirmed delivery's Ethereal preview link and search for recipient, subject and body text.
5. Restart `worker` while a future job exists and confirm it remains in Bull Board and later sends.

## Deployment

An always-on Compose stack, persistent volumes, separate API/worker restarts, Caddy HTTPS, exact callback URLs, migrations and deployed SMTP connectivity checks are documented in [docs/deployment.md](docs/deployment.md). A static-only host is intentionally unsupported because BullMQ needs an always-running worker.

## Evidence matrix

| Requirement | Evidence | Status |
| --- | --- | --- |
| PostgreSQL authority and migration | `prisma/schema.prisma`, committed SQL migration | Verified on PostgreSQL 17 |
| Transactional scheduling/idempotency | `apps/api/src/schedule.ts`, unit/integration suite | Verified |
| Crash-safe queue publication | `apps/api/src/outbox.ts`, stale-claim/restart integration test | Implemented |
| Shared concurrency/rate limits | Redis Lua in `packages/shared/src/rate-limit.ts`, racing-worker integration tests | Implemented |
| SMTP retries/ambiguity/idempotency | `apps/worker/src/processors.ts`, policy tests, `npm run smoke:ethereal` | Verified with real Ethereal acceptance and preview |
| Google OIDC/session ownership | `apps/api/src/auth.ts`, protected/owner-scoped routes | Implemented; live consent check pending |
| Slack OAuth/threshold dedupe | `apps/api/src/slack.ts`, worker notification event, reconnect test | Implemented; live Slack check pending |
| Elasticsearch/versioned indexing | setup/reindex scripts, index worker, owner-filter test | Verified on Elasticsearch 9.1.4 |
| Bull Board admin authorization | `/admin/queues` + `ADMIN_EMAILS` middleware | Implemented |
| Dashboard/CSV/timezone/pagination | `apps/web`, parser tests | Implemented; Figma pixel match blocked by inaccessible frames |
| Local/production operations | both Compose files, Dockerfile, Caddyfile, health endpoints | Implemented |

Final automated result: **15/15 tests passed**, all workspace type checks and lint passed, production builds passed, the production Docker image built successfully, dependency audit reported **0 vulnerabilities**, and readiness returned all three dependencies healthy. Google login and Slack posting remain credential/consent-blocked; they are implemented but not claimed as live-verified.

See [docs/requirements-checklist.md](docs/requirements-checklist.md) for the concise checklist, [docs/demo-script.md](docs/demo-script.md) for a sub-five-minute walkthrough, and [docs/tradeoffs.md](docs/tradeoffs.md) for review-ready design decisions.
