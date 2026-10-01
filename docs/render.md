# Render deployment

This runbook deploys a fresh production environment from the root
[`render.yaml`](../render.yaml). It does not copy the local PostgreSQL database,
Redis state, Elasticsearch data, pending BullMQ jobs, OAuth sessions, or `.env`.
That avoids running the same pending jobs from both the laptop and Render.

Do not click **Apply** in Render until the recurring cost below is approved. Merely
pushing these files to GitHub does not create or bill any Render resource.

## Architecture

| Blueprint resource | Render plan | Purpose |
| --- | --- | --- |
| `reachinbox-scheduler` | `0.5c-512mb` | Paid web service running Express and serving the built React application from the same HTTPS origin |
| `reachinbox-worker` | `0.5c-512mb` | Continuously running BullMQ email, indexing, and Slack workers; this is where Ethereal SMTP is used |
| `reachinbox-postgres` | `0.1c-256mb`, 5 GB | Users, sessions, senders, campaigns, delivery state, idempotency, and outbox authority |
| `reachinbox-redis` | `256mb` | Persistent Render Key Value instance with `journal-snapshot` and `noeviction` for BullMQ and rate limits |
| `reachinbox-elasticsearch` | `1c-2g`, 10 GB disk | Private single-node Elasticsearch with a 1 GB JVM heap and persistent index storage |

Only the web service is public. PostgreSQL and Key Value have empty public IP
allow lists. Elasticsearch is a private service. All resources use Render's
Singapore region and one instance. Do not enable paid pull-request preview
environments, which could create duplicate workers and additional spend.

The API reads Render's platform-provided `PORT`. Render's external hostname is
used to derive `WEB_ORIGIN`, `PUBLIC_ORIGIN`, and both OAuth callbacks. The private
Elasticsearch host and port are converted to `ELASTICSEARCH_URL`. Explicit values
still take precedence, so local and existing non-Render environments are unchanged.

## Estimated monthly price

Pricing checked against [Render's public pricing page](https://render.com/pricing)
on 1 October 2026. The fixed
baseline on a Hobby workspace is:

| Item | Calculation | Monthly estimate |
| --- | ---: | ---: |
| Web service | one `0.5c-512mb` service | $7.00 |
| Background worker | one `0.5c-512mb` worker | $7.00 |
| Private Elasticsearch compute | one `1c-2g` private service | $25.00 |
| Elasticsearch persistent disk | 10 GB x $0.25/GB | $2.50 |
| Render Key Value | one `256mb` instance | $10.00 |
| PostgreSQL compute | one `0.1c-256mb` database | $6.00 |
| PostgreSQL storage | 5 GB x $0.30/GB | $1.50 |
| Hobby workspace | $0 | $0.00 |
| **Fixed baseline total** |  | **$59.00/month** |

This excludes taxes and usage-based overages. The Hobby workspace currently
includes 5 GB outbound bandwidth and 500 build-pipeline minutes per month; excess
bandwidth is $0.15/GB and excess build time is $5 per 1,000 minutes. Two custom
domains are included, but this deployment can use the generated `onrender.com`
hostname without buying a domain. Render prorates compute, so a partial month can
cost less than the full baseline.

Render documents [paid Key Value persistence](https://render.com/docs/key-value)
as journal and snapshot storage, and recommends a
[private service with persistent disk for Elasticsearch](https://render.com/docs/deploy-elasticsearch).
Those durable options are why the Blueprint does not substitute free instances for
the queue or search services.

## Push the reviewed files

The existing `origin` remote points to the intended GitHub repository. At review
time GitHub reports that repository as **public**. If the assignment repository is
intended to be private, change it under **Settings > General > Danger Zone > Change
repository visibility** before connecting Render. Review the diff, commit only the
deployment changes, and push without force:

```bash
git diff --check
git status --short
git add render.yaml docs/render.md README.md packages/shared/src/config.ts tests/unit/domain.test.ts
git diff --cached --check
git diff --cached
git commit -m "Add Render deployment blueprint"
git push origin main
```

Render can connect to a private repository through its GitHub app after you grant
that repository access. Do not add `.env`; it is ignored and the Blueprint contains
no credential values.

## Import the Blueprint without provisioning yet

1. Sign in to Render and open **New > Blueprint**.
2. Connect GitHub and grant Render access only to the private ReachInbox repository.
3. Select `AbhayChougala/reachinbox-email-scheduler`, branch `main`.
4. Keep the Blueprint path as `render.yaml`.
5. Review the five resources, Singapore region, instance plans, and the price.
6. Enter the prompted values listed below, but stop before **Apply** until the
   $59/month baseline is approved.

No paid resource exists and no charge begins merely from preparing or pushing the
Blueprint. Applying the Blueprint is the provisioning action.

## Environment values to enter

The Blueprint generates `SESSION_SECRET` and `INTEGRATION_ENCRYPTION_KEY`, and
connects PostgreSQL, Key Value, Elasticsearch, and the worker automatically. Enter
these prompted values during the first Blueprint import:

| Variable | Value to provide |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Existing Google OAuth web-client ID |
| `GOOGLE_CLIENT_SECRET` | Existing Google OAuth client secret |
| `SLACK_CLIENT_ID` | Existing numeric Slack client ID, including its dot |
| `SLACK_CLIENT_SECRET` | Current Slack client secret |
| `ADMIN_EMAILS` | Comma-separated Google emails permitted to access Bull Board |
| `PROVISION_OWNER_EMAIL` | Google email that should own the two production Ethereal senders |
| `PROVISION_OWNER_NAME` | Display name for that owner |

Do not copy the local `.env` into Render and do not put any secret in `render.yaml`.
After provisioning, securely back up the generated integration encryption key and
session secret. Never regenerate the encryption key while encrypted sender or Slack
credentials exist.

## OAuth callback URLs

After Render assigns the web service hostname, copy the exact HTTPS origin shown on
the `reachinbox-scheduler` service page. If it is
`https://reachinbox-scheduler.onrender.com`, register:

```text
Google: https://reachinbox-scheduler.onrender.com/api/auth/google/callback
Slack:  https://reachinbox-scheduler.onrender.com/api/integrations/slack/callback
```

Substitute the actual assigned hostname if Render adds a suffix. Keep the existing
localhost/tunnel Google redirect entries; adding the Render callback does not
require deleting them. This application uses a server-side Google flow, so no
Authorized JavaScript origin is required. Slack needs the `incoming-webhook` scope.

## First-deploy commands

The web service automatically runs the first two commands as its pre-deploy command
on every release:

```bash
npm run db:migrate
npm run search:setup
```

After the web and worker services are live, open the web service Shell and first
confirm that paid Render compute can reach Ethereal SMTP:

```bash
node -e "const s=require('node:net').connect(587,'smtp.ethereal.email');s.once('connect',()=>{console.log('SMTP reachable');s.end()});s.once('error',e=>{console.error(e.message);process.exit(1)})"
```

Then provision exactly two production Ethereal senders for
`PROVISION_OWNER_EMAIL`:

```bash
npm run db:seed:senders
```

The provisioning command is safe to rerun when that owner already has two enabled
senders; do not run it merely as part of ordinary deploys. If messages predate the
Elasticsearch index, rebuild it from PostgreSQL with:

```bash
npm run search:reindex
```

## Verification after deployment

1. `GET https://<hostname>/health/live` returns 200, then `/health/ready` returns
   200 with PostgreSQL, Redis, and Elasticsearch all `true`.
2. Open `https://<hostname>`, complete Google login, log out, and log back in. Check
   that the session cookie is Secure, HttpOnly, host-only, SameSite=Lax, and returned
   on callbacks.
3. Confirm two senders are visible only to `PROVISION_OWNER_EMAIL` and send one
   scheduled email through Ethereal. Open its Preview link.
4. Search that message in Scheduled/Sent tabs and confirm the selected-tab filters.
5. Connect Slack to the designated test channel and, only with channel approval,
   verify one real rate-limit notification.
6. Open `https://<hostname>/admin/queues` as an `ADMIN_EMAILS` user; confirm anonymous
   and non-admin access is rejected.
7. Schedule a future message, restart only `reachinbox-worker`, and confirm one
   eventual delivery with no replay of completed messages.
8. Stop the laptop's local services and tunnel, then repeat health, login, search,
   and scheduling checks to prove Render is independent.
