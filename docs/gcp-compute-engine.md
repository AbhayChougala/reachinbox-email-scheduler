# Google Compute Engine deployment

This is the submission deployment path: one Compute Engine VM running the production Compose stack. It deliberately starts with a fresh PostgreSQL database, empty Redis/Elasticsearch volumes, and newly provisioned Ethereal accounts. Do **not** copy the local PostgreSQL or Redis volumes to the VM; the laptop worker and VM worker must never share duplicated pending jobs.

## 1. Mandatory Free Trial gate

No cloud resource should be created until all of these are visible in Google Cloud Console:

1. Open **Billing → Overview** and select the billing account for the intended project.
2. Confirm the account status explicitly says **Free Trial**, not paid/pay-as-you-go.
3. Confirm a positive remaining Welcome credit balance and an expiry date after the submission review.
4. Do not click **Upgrade**. Record the remaining balance privately; do not put billing screenshots or identifiers in Git.

Google currently describes the trial as $300 of Welcome credit for 90 days and says a non-upgraded trial account is not charged after its credits or trial period end. `e2-standard-2`, persistent disk, and external IPv4 usage are billable and consume that credit; they are not an Always Free deployment. See the [official Free Trial FAQ](https://cloud.google.com/signup-faqs).

## 2. Stable free hostname preflight

A raw VM IP cannot be a Google OAuth web redirect host. Without a purchased domain, create a unique free DuckDNS subdomain that you control, for example `reachinbox-<unique>.duckdns.org`. DuckDNS documents free account-controlled subdomains and HTTPS record updates at <https://www.duckdns.org/>.

Before creating the VM, verify provider acceptance by saving these two exact values in the existing OAuth applications, replacing `<hostname>` with the subdomain actually assigned to your DuckDNS account:

- Google authorized redirect URI: `https://<hostname>/api/auth/google/callback`
- Slack OAuth redirect URL: `https://<hostname>/api/integrations/slack/callback`

The application uses server-side Google OIDC, so no Authorized JavaScript origin is required. Google requires HTTPS, a public-suffix hostname rather than a raw IP, and an exact redirect match. Slack requires HTTPS and requires the redirect used during authorization and token exchange to match its configured URL. If either console rejects the DuckDNS hostname, stop before provisioning and use another account-controlled free hostname; do not fall back to an IP address or an ephemeral Quick Tunnel.

## 3. Create the project and VM in Cloud Console

Local `gcloud` is not required. Open Cloud Shell from Google Cloud Console after the billing gate passes, select or create a project, and replace the four shell variables below. `REACHINBOX_HOSTNAME` is the full DuckDNS name; it is not a secret.

```bash
export PROJECT_ID='<google-cloud-project-id>'
export REGION='asia-south1'
export ZONE='asia-south1-a'
export REACHINBOX_HOSTNAME='<assigned-subdomain>.duckdns.org'
gcloud config set project "$PROJECT_ID"
gcloud services enable compute.googleapis.com
```

Reserve an IPv4 address, then create the requested Ubuntu VM. The reserved address consumes trial credit even while attached, so delete it after evaluation.

```bash
gcloud compute addresses create reachinbox-ip --region="$REGION"
export PUBLIC_IP="$(gcloud compute addresses describe reachinbox-ip --region="$REGION" --format='value(address)')"
gcloud compute instances create reachinbox-scheduler \
  --zone="$ZONE" \
  --machine-type=e2-standard-2 \
  --image-project=ubuntu-os-cloud \
  --image-family=ubuntu-2404-lts-amd64 \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-balanced \
  --address="$PUBLIC_IP" \
  --tags=reachinbox-web \
  --metadata=enable-oslogin=TRUE
gcloud compute firewall-rules create reachinbox-web-ingress \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=reachinbox-web
```

Do not create firewall rules for 4000, 5432, 6379, or 9200. Compose publishes only Caddy's ports 80/443; the API, PostgreSQL, Redis, and Elasticsearch stay on its private network.

In DuckDNS, set the selected subdomain's IPv4 address to the reserved `PUBLIC_IP`. Verify before continuing:

```bash
getent ahostsv4 "$REACHINBOX_HOSTNAME"
```

The returned address must match `PUBLIC_IP`.

## 4. VM SMTP and host preflight

Connect with the Console **SSH** button or:

```bash
gcloud compute ssh reachinbox-scheduler --zone="$ZONE"
```

Before deploying the application, verify the VM itself can reach Ethereal on port 587:

```bash
timeout 10 bash -c '</dev/tcp/smtp.ethereal.email/587'
```

Exit status `0` is the required result. Google documents that Compute Engine does not restrict outbound ports 587 or 465; port 25 is normally restricted. If this check fails, inspect project egress policy and stop—do not provision sender accounts yet.

Install Docker Engine and the Compose plugin from Docker's official Ubuntu repository, then verify:

```bash
docker --version
docker compose version
```

Clone the private repository using the review account's authorized GitHub SSH key. Do not embed a GitHub token in the URL:

```bash
git clone git@github.com:AbhayChougala/reachinbox-email-scheduler.git
cd reachinbox-email-scheduler
git switch main
```

## 5. Production secrets

Create a host-only `.env`; never upload the local `.env`, a database dump, Redis files, or Docker volumes:

```bash
umask 077
install -m 600 /dev/null .env
nano .env
```

Set all names from `.env.example`. Required production differences are:

```dotenv
NODE_ENV=production
PORT=4000
APP_DOMAIN=<assigned-subdomain>.duckdns.org
WEB_ORIGIN=https://<assigned-subdomain>.duckdns.org
PUBLIC_ORIGIN=https://<assigned-subdomain>.duckdns.org
TRUST_PROXY=true
DATABASE_URL=postgresql://reachinbox:<url-safe-postgres-password>@postgres:5432/reachinbox?schema=public
REDIS_URL=redis://redis:6379
ELASTICSEARCH_URL=http://elasticsearch:9200
GOOGLE_REDIRECT_URI=https://<assigned-subdomain>.duckdns.org/api/auth/google/callback
SLACK_REDIRECT_URI=https://<assigned-subdomain>.duckdns.org/api/integrations/slack/callback
PROVISION_OWNER_EMAIL=<exact-google-email-that-will-demo-the-app>
PROVISION_OWNER_NAME=<display-name>
ADMIN_EMAILS=<comma-separated-google-emails-allowed-to-open-bull-board>
```

Use new, independent high-entropy values for `POSTGRES_PASSWORD`, `SESSION_SECRET`, and `INTEGRATION_ENCRYPTION_KEY`. The encryption key must be exactly 32 random bytes encoded as base64. Enter the existing provider client IDs/secrets directly into this file without printing them. Keep `chmod 600 .env`; never use `docker compose config` without `--quiet`, because expanded output can contain secrets.

## 6. First deployment: fresh data only

Run the repository's supported commands in this order:

```bash
docker compose --env-file .env -f docker-compose.prod.yml build
docker compose --env-file .env -f docker-compose.prod.yml up -d postgres redis elasticsearch
docker compose --env-file .env -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env -f docker-compose.prod.yml run --rm api npm run search:setup
docker compose --env-file .env -f docker-compose.prod.yml run --rm api npm run db:seed:senders
docker compose --env-file .env -f docker-compose.prod.yml up -d api worker caddy
```

`db:seed:senders` upserts the intended owner by exact Google email and creates two encrypted Ethereal sender accounts only when fewer than two exist. The later Google login claims that same owner row. To prepare a separate reviewer without sharing data, temporarily set `PROVISION_OWNER_EMAIL` to that reviewer's exact Google email and run the same supported sender command; their two sender rows remain owner-scoped. No direct database edit is required.

## 7. Readiness and public verification

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=100 api worker caddy
curl -fsS "https://$REACHINBOX_HOSTNAME/health/live"
curl -fsS "https://$REACHINBOX_HOSTNAME/health/ready"
```

All six long-running services must be running and the API, worker, Caddy, PostgreSQL, Redis, and Elasticsearch health checks must pass. Verify from another machine that ports 4000, 5432, 6379, and 9200 are unreachable.

Then complete the browser checklist in `docs/submission-checklist.md`. Slack authorization and the real channel alert require the account owner's consent and must not be claimed from logs alone.

## 8. Operations and cleanup

Routine migration and replacement:

```bash
docker compose --env-file .env -f docker-compose.prod.yml build api worker
docker compose --env-file .env -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env -f docker-compose.prod.yml up -d --no-deps api worker
```

Restart only application processes:

```bash
docker compose --env-file .env -f docker-compose.prod.yml restart api worker
```

After review, stop charges by deleting both the VM and reserved address from Cloud Shell:

```bash
gcloud compute instances delete reachinbox-scheduler --zone="$ZONE"
gcloud compute addresses delete reachinbox-ip --region="$REGION"
```
