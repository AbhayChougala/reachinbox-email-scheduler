# Architecture

The browser talks only to the Express API. Express owns OIDC/session state, tenant authorization, campaign transactions, search, Slack OAuth and Bull Board authorization. PostgreSQL is authoritative. Redis contains BullMQ state and atomic, shared admission counters. The independently deployed worker sends SMTP mail, indexes Elasticsearch documents and posts Slack notifications.

## Scheduling lifecycle

1. The browser converts its explicit local date/time to an ISO UTC instant and sends its IANA timezone plus an idempotency key.
2. One PostgreSQL transaction verifies sender ownership, stores the campaign/messages/request fingerprint, and creates one `EMAIL_ENQUEUE` outbox row per message.
3. A bounded dispatcher claims rows with `FOR UPDATE SKIP LOCKED`. It adds deterministic BullMQ jobs (`email-<message id>`) and only then marks events published. Stale claims are recovered after 60 seconds. Retrying `Queue.add` is harmless because the job ID is stable.
4. BullMQ releases the job at its effective due time. A Redis Lua script atomically applies sender spacing, the sender's fixed UTC-hour cap and a campaign cap. A denied job is moved to its next eligible delayed time without consuming an SMTP attempt.
5. The worker atomically claims the database message, records an attempt, delivers it, persists the result, and emits an idempotent search-index event.

## Limits and concurrency

The sender hourly counter is shared by all campaigns and workers. A campaign limit may be lower and has its own counter; it can tighten but never reset the sender quota. The hourly window is `[HH:00:00Z, next HH:00:00Z)`. Minimum spacing uses Redis server time and a per-sender last-admission key. No worker sleeps, so another sender is never blocked.

If 1,000 messages are due, BullMQ exposes them to a bounded worker concurrency. The database dispatcher claims at most `OUTBOX_BATCH_SIZE` rows and all list/search endpoints use cursor/offset pagination. Redis admission serializes only jobs for the same sender.

## Failure semantics

SMTP and PostgreSQL cannot participate in one atomic transaction. A crash after SMTP acceptance and before success is recorded may have delivered the email. Such a stale `SENDING` row is marked `AMBIGUOUS` on worker startup and is never blindly resent. A deterministic RFC Message-ID aids investigation but is not treated as deduplication.

Elasticsearch is eventually consistent and non-authoritative. Index work retries independently, uses external document versions, and cannot block sending. PostgreSQL can recreate the whole index with the reindex command.

Slack notification identity is `(owner, sender, UTC hour)`. The event is created when the admitted count first reaches the cap, not for every later rejection. Delivery retries independently; disconnecting marks the integration disabled.
