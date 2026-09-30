# Final submission checklist

## Repository

- [ ] GitHub repository reports **Private**.
- [ ] Required reviewer identities are verified before invitations are sent.
- [ ] `.env`, credential files, database/Redis dumps, logs, dependencies, and build output are untracked.
- [ ] Source, lockfile, migration, production Compose, Dockerfile, Caddyfile, `.env.example`, sample CSV, API documentation, README, deployment guide, and demo script are committed.
- [ ] Secret-pattern/history scan is clean; no secret value is pasted into an issue, commit, screenshot, or CI log.

## Cloud gate and deployment

- [ ] Billing Overview says **Free Trial**, shows positive unexpired Welcome credit, and has not been upgraded.
- [ ] Account-controlled free hostname is assigned and accepted by both Google and Slack callback settings.
- [ ] `e2-standard-2`, Ubuntu 24.04 LTS, 30 GB persistent disk, and one reserved IPv4 are the only intended VM resources.
- [ ] Only ports 80/443 are public; 4000/5432/6379/9200 are not reachable externally.
- [ ] VM-to-`smtp.ethereal.email:587` preflight succeeds.
- [ ] Production `.env` exists only on the VM with mode 600 and independent production keys.
- [ ] Production uses fresh PostgreSQL/Redis/Elasticsearch volumes; no local jobs or database dump were copied.
- [ ] Migrations, `search:setup`, and `db:seed:senders` completed before API/worker verification.
- [ ] PostgreSQL, Redis, Elasticsearch, API, worker, and Caddy are healthy after a VM reboot.

## Live application

- [ ] Public `/health/live` and `/health/ready` return 200 over valid HTTPS.
- [ ] Google login and logout succeed on the production hostname.
- [ ] Intended owner sees exactly their two provisioned senders and no other user's data.
- [ ] Scheduled/Sent tabs and tab-scoped search work; failed rows do not fabricate a sent time.
- [ ] One scheduled email is accepted by Ethereal and its Preview opens.
- [ ] Minimum spacing and sender-hour deferral are demonstrated without clearing Redis.
- [ ] Slack OAuth is completed by the owner for `scheduler-alert`.
- [ ] Owner confirms one real limit alert is visibly present; provider acceptance alone is not enough.
- [ ] A delayed email survives an API/worker restart, sends once, and completed messages are not replayed.
- [ ] Bull Board is 401 anonymously, 403 for non-admins, and available to an `ADMIN_EMAILS` account.
- [ ] The deployment remains healthy while all laptop services and the Quick Tunnel are stopped.

## Submission

- [ ] README contains the final production URL and demo-video URL.
- [ ] Under-five-minute video follows `docs/demo-script.md` and does not expose secrets.
- [ ] Known limitations and live-versus-automated evidence are accurate.
- [ ] Reviewer invitations are sent manually only after identities are confirmed.
- [ ] No application form has been submitted automatically.
