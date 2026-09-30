# Demo script (under five minutes)

1. **Architecture (30 seconds).** Show `docker compose ps`, then the architecture diagram/paragraph in `docs/architecture.md`. Point out separate API and worker processes.
2. **Login and sender ownership (30 seconds).** Sign in with Google, show the identity header and two provisioned Ethereal senders. Mention encrypted credentials and owner-scoped queries.
3. **Schedule (75 seconds).** Use `sample-leads.csv`. Show detected/valid/invalid/duplicate counts, browser timezone, a future start, five-second spacing and a cap of 2. Submit, then click only once more to explain the stable idempotency key while the request is in flight.
4. **Persistence and observability (45 seconds).** Open the admin queue monitor. Restart the worker container and show the delayed jobs remain. Return to scheduled emails and point out effective time/deferral reason.
5. **Delivery/search (60 seconds).** Let two messages send, open their Ethereal previews, search by recipient/body, and show the third delayed to the next real UTC hour.
6. **Slack (30 seconds).** Show the connected workspace/channel and the single real threshold notification. Explain that it fires on reaching the cap and is unique per sender/hour.
7. **Honest failure semantics (30 seconds).** Show the `AMBIGUOUS` status description and explain why SMTP cannot be exactly-once with a database transaction.

For a quick quota demo, set the chosen sender's `hourlyLimit` to 2 (or provision with `DEFAULT_SENDER_HOURLY_LIMIT=2`) and schedule exactly three recipients. Do not shorten the hour.
