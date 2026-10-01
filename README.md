# ReachInbox email scheduler

A full-stack, owner-scoped email scheduling application for the Outbox Labs hiring assignment. It commits campaigns to PostgreSQL, recovers queue publication through a transactional outbox, schedules one durable BullMQ job per recipient, enforces sender-wide limits atomically in Redis, sends through persistent Ethereal accounts, indexes state in Elasticsearch, and notifies Slack when a sender reaches its real UTC-hour cap.

## Submission links

- Temporary laptop-backed demo: `https://excited-magnitude-checklist-neither.trycloudflare.com` (accountless Quick Tunnel; **not** a production deployment and may expire).
- Production deployment: Render Blueprint prepared but not provisioned pending approval of the reviewed recurring cost; see the [Render runbook](docs/render.md).
- Demo video: not recorded/provided yet.

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

- Google Cloud web client callback: `http://localhost:4000/api/auth/google/callback`. This server-side flow does not require an Authorized JavaScript origin.
- Slack local testing uses the single-origin HTTPS tunnel in [docs/local-https.md](docs/local-https.md); add only the `incoming-webhook` scope.

Set `PROVISION_OWNER_EMAIL` to the same Google email, then create exactly two durable Ethereal accounts (the generated passwords are AES-GCM encrypted before storage):

```bash
npm run db:seed:senders
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:4000`. A user listed in `ADMIN_EMAILS` can open `http://localhost:4000/admin/queues` after Google login.

For a single-origin HTTPS demo, start one Quick Tunnel pointing at Vite, then use its current origin with the guarded launcher:

```bash
cloudflared tunnel --url http://localhost:5173 --no-autoupdate --protocol http2
DEV_HTTPS_ORIGIN=https://<current-tunnel-host> npm run dev:https
```

Register `https://<current-tunnel-host>/api/auth/google/callback` with Google and `https://<current-tunnel-host>/api/integrations/slack/callback` with Slack. Do not run `npm run dev` beside the guarded launcher; it refuses occupied ports so stale configuration cannot silently become the serving process.

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
3. Connect Slack, choose only the test channel, run `npm run demo:configure-rate-limit`, and schedule `slack-rate-limit-demo.csv` (3 rows). The helper refuses to change the sender if its current-hour quota is non-zero and never clears counters. Confirm exactly one threshold message and a third email delayed to the next actual UTC hour.
4. Open each confirmed delivery's Ethereal preview link and search for recipient, subject and body text.
5. Restart `worker` while a future job exists and confirm it remains in Bull Board and later sends.

## Deployment

The reviewed [Render Blueprint](render.yaml) and [Render runbook](docs/render.md) define one same-origin web/API service, a separate always-running BullMQ worker, paid persistent Key Value, PostgreSQL, and private persistent Elasticsearch. The runbook includes the exact recurring-cost estimate, GitHub/import steps, OAuth callbacks, migrations, sender provisioning, and post-deploy verification. No Render resource has been provisioned. A static-only or free sleeping service is intentionally unsupported because SMTP and BullMQ require a continuously running worker.

## Evidence matrix

| Requirement | Evidence | Status |
| --- | --- | --- |
| PostgreSQL authority and migration | `prisma/schema.prisma`, committed SQL migration | Verified on PostgreSQL 17 |
| Transactional scheduling/idempotency | `apps/api/src/schedule.ts`, unit/integration suite | Verified |
| Crash-safe queue publication | `apps/api/src/outbox.ts`, stale-claim test and real delayed-job process restart | Live verified |
| Shared concurrency/rate limits | Redis Lua plus real cap-2 campaign: two accepted, third moved to the next UTC hour | Live verified |
| SMTP retries/ambiguity/idempotency | `apps/worker/src/processors.ts`, policy tests, `npm run smoke:ethereal` | Verified with real Ethereal acceptance and preview |
| Google OIDC/session ownership | `apps/api/src/auth.ts`, protected/owner-scoped routes | Live verified through real Google consent |
| Slack OAuth/threshold dedupe | Real OAuth to `AB work → #scheduler-alert`; webhook accepted exactly once; automated dedupe/reconnect coverage | Live provider acceptance; visible-channel confirmation pending |
| Elasticsearch/versioned indexing | Owner-filtered API search returned live scheduled/sent documents; tab/query/page identity prevents stale responses crossing views | Live API verified on Elasticsearch 9.1.4; UI regression tested |
| Bull Board admin authorization | `/admin/queues` returns 401 anonymously and 403 for the current non-admin | Protection live verified; authorized view needs `ADMIN_EMAILS` |
| Dashboard/CSV/timezone/pagination | Parser tests plus empty/typed search-control checks at desktop and narrow widths | Functionally and visually verified; Figma pixel match blocked by unavailable frames |
| Local/production operations | Dockerfile, Render Blueprint, Compose files, dependency health checks, and fresh-data Render runbook | Built and locally validated; paid Render provisioning awaits explicit cost approval |

The current verification commands and evidence are tracked in [docs/requirements-checklist.md](docs/requirements-checklist.md). Real Google login, Slack OAuth, Slack webhook acceptance, Ethereal acceptance/preview, Elasticsearch search, durable restart recovery, and service readiness have been live verified. Slack channel visibility still requires human confirmation; an accepted webhook response alone is not described as visible delivery.

See [docs/requirements-checklist.md](docs/requirements-checklist.md) for the concise checklist, [docs/demo-script.md](docs/demo-script.md) for a sub-five-minute walkthrough, and [docs/tradeoffs.md](docs/tradeoffs.md) for review-ready design decisions.
