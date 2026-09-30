# Requirements checklist

Legend: **Implemented** means code exists, **verified** means exercised locally, and **blocked** means external credentials or inaccessible design data are still needed.

## Core

- [x] npm-workspace monorepo: React/Vite, Express, worker, shared package
- [x] PostgreSQL/Prisma schema for users, senders, campaigns, messages, attempts, outbox and integrations
- [x] BullMQ job per recipient with deterministic IDs and delayed delivery
- [x] Transactional database outbox with stale-claim recovery
- [x] Redis-atomic sender spacing, fixed UTC-hour quotas and campaign tightening
- [x] Encrypted, durable Ethereal SMTP credentials and provisioning script
- [x] Explicit ambiguous SMTP outcome state
- [x] Owner/idempotency constraints and protected routes

## Product and integrations

- [x] Real Google OIDC authorization-code + PKCE/state/nonce flow
- [x] Persistent server-side sessions and secure cookies
- [x] Compose/upload/timezone dashboard and scheduled/sent views
- [x] Real Slack OAuth incoming-webhook flow and threshold notifications
- [x] Elasticsearch indexing, version guards, owner-filtered search and reindex command
- [x] Authenticated admin-only Bull Board
- [ ] Pixel-perfect Figma match — **blocked:** public link exposes only the assignment cover; dashboard screenshots are required

## Operations and evidence

- [x] Local infrastructure Compose with AOF/noeviction and named volumes
- [x] Production Compose, Caddy guidance, migrations and smoke tests
- [x] Health/live and health/ready endpoints
- [x] Unit and integration-oriented tests
- [ ] Live Google login — **blocked:** user credentials/configuration required
- [ ] Live Slack notification — **blocked:** user Slack app/workspace authorization required
- [x] Live Ethereal delivery — verified through PostgreSQL outbox → BullMQ → worker → real Ethereal SMTP; preview URL returned
- [x] Full live Elasticsearch smoke test — mapping created on Elasticsearch 9.1.4 and readiness confirmed
- [x] PostgreSQL/Redis recovery and concurrency suite — 8/8 service-backed tests passed

Verification results are updated in the root README at handoff.
