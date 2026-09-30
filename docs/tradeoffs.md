# Tradeoffs and review notes

## Delivery semantics

The design chooses at-most-once behavior after an ambiguous SMTP outcome. It avoids the more harmful default of retrying an email that the SMTP server may already have accepted. `AMBIGUOUS` is visible in the sent tab for manual review. This is not unconditional exactly-once delivery; SMTP has no transaction coordinated with PostgreSQL.

## Scheduling and limits

BullMQ owns delivery timing. The database outbox recovery loop only bridges committed database work into BullMQ; it is not a second scheduler. Redis Lua makes quota and spacing admission atomic across any number of worker processes. Fixed UTC hours are easy to explain and audit, though a sliding window would smooth boundary bursts.

Campaign delay is also treated as a minimum sender interval for that campaign. Sender limits remain global; campaign counters only tighten them. An admitted failed SMTP attempt consumes capacity because the requirement is a cap on send attempts, not confirmed deliveries.

## Search

The UI deliberately returns a visible 503 search state if Elasticsearch is unavailable. Falling back silently to PostgreSQL would falsely present that integration as healthy. PostgreSQL remains the recovery source and the reindex command uses bounded 500-row pages.

## Security

SMTP passwords, Slack webhooks and tokens use AES-256-GCM with a server-owned key. Key rotation would require a versioned re-encryption command in a longer-lived product. Session cookies are HttpOnly/SameSite and Secure in production. Same-origin deployment plus origin checking protects state changes; a public API for cross-origin clients would warrant explicit CSRF tokens.

## Figma

The public design URL exposed only the cover thumbnail, not the referenced dashboard frames. The UI therefore uses its visible black, white and warm-gray Outbox Labs language without claiming pixel accuracy. A screenshot handoff is required for exact comparison.
