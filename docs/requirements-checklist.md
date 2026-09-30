# Requirements checklist

Status meanings:

- **Implemented** — production code and configuration exist.
- **Automatically tested** — repeatable tests exercise the behavior without claiming a real provider interaction.
- **Live verified** — exercised against the real local service or external provider.
- **Blocked** — the exact external action still required is named.

| Requirement | Implemented | Automatically tested | Live verified / blocked |
| --- | :---: | :---: | --- |
| React/Vite dashboard, Express API, independent worker, shared package | Yes | Yes | **Live verified:** web `5173`, API `4000`, and worker run together locally |
| PostgreSQL models, migrations, tenant ownership, idempotency, transactional outbox | Yes | Yes | **Live verified:** PostgreSQL 17 readiness and durable local data |
| BullMQ job per recipient, delayed delivery, stale-claim recovery | Yes | Yes | **Live verified:** real queues processed the Ethereal smoke delivery |
| Redis-atomic sender spacing, UTC-hour limits, concurrent workers | Yes | Yes | **Live verified:** cap-2 UI campaign accepted two SMTP deliveries and deferred the third to the real next UTC hour without consuming an SMTP attempt |
| Durable encrypted Ethereal sender credentials | Yes | Yes | **Live verified:** real SMTP acceptance and preview URL; existing accounts preserved |
| Google OIDC authorization code, PKCE/state/nonce, persistent session | Yes | Yes | **Live verified:** user completed real Google login |
| Slack incoming-webhook OAuth, user-bound expiring state, encrypted connection, reconnect/disconnect | Yes | Yes | **Live verified:** real Slack OAuth stores an enabled owner-scoped `AB work → #scheduler-alert` integration |
| One Slack threshold event per owner/sender/UTC hour, isolated retries | Yes | Yes | **Provider accepted:** exactly one event and one successful webhook attempt; **blocked:** human confirmation that the alert is visible in `scheduler-alert` |
| Elasticsearch versioned indexing, owner-filtered search, reindex | Yes | Yes | **Live verified:** Elasticsearch 9.1.4 readiness, index setup, and reindex |
| Authenticated admin-only Bull Board | Yes | Yes | **Protection live verified:** 401 anonymous and 403 current signed-in non-admin; **blocked:** add that account to `ADMIN_EMAILS` and capture the authorized 200 view |
| Restart survival and terminal-message no-resend behavior | Yes | Yes | **Live verified:** a future secondary-sender job survived API/worker child replacement, sent once, produced one preview, indexed as `SENT`, and prior terminal attempt counts did not change |
| Production Dockerfile, private service network, volumes, Caddy HTTPS | Yes | Build verification | **Blocked:** deploy target domain/host are not selected; no paid resource was created |
| Pixel-perfect Figma fidelity | Partial | No | **Blocked:** the available public reference exposes only the cover, not dashboard frames |
| Search control icon/text spacing and responsive toolbar | Yes | Yes | **Live visual fixture verified:** empty and typed text do not overlap; focus indication is visible and controls wrap at 375 px |

## Figma evidence still needed

Provide full-resolution desktop frames (and mobile frames if mobile is in scope) for: login; populated and empty scheduled views; sent view with preview action; compose modal including CSV validation counts; Slack disconnected and connected states; loading, no-results, and error states. Without those frames, the current warm-gray Outbox Labs treatment can be reviewed functionally but cannot honestly be called pixel-perfect.
