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
| Redis-atomic sender spacing, UTC-hour limits, concurrent workers | Yes | Yes | **Blocked for live three-message evidence:** connect Slack, then run the prepared cap-2 UI demo without clearing quota |
| Durable encrypted Ethereal sender credentials | Yes | Yes | **Live verified:** real SMTP acceptance and preview URL; existing accounts preserved |
| Google OIDC authorization code, PKCE/state/nonce, persistent session | Yes | Yes | **Live verified:** user completed real Google login |
| Slack incoming-webhook OAuth, user-bound expiring state, encrypted connection, reconnect/disconnect | Yes | Yes | **Blocked:** approve the existing Slack app for the selected test channel |
| One Slack threshold event per owner/sender/UTC hour, isolated retries | Yes | Yes | **Blocked for live alert:** same Slack credential/consent action above |
| Elasticsearch versioned indexing, owner-filtered search, reindex | Yes | Yes | **Live verified:** Elasticsearch 9.1.4 readiness, index setup, and reindex |
| Authenticated admin-only Bull Board | Yes | Yes | **Blocked for live browser evidence:** sign in through the tunnel with an email listed in `ADMIN_EMAILS` |
| Restart survival and terminal-message no-resend behavior | Yes | Yes | **Blocked for live timed evidence:** schedule from the authenticated UI and perform the documented worker restart |
| Production Dockerfile, private service network, volumes, Caddy HTTPS | Yes | Build verification | **Blocked:** deploy target domain/host are not selected; no paid resource was created |
| Pixel-perfect Figma fidelity | Partial | No | **Blocked:** the available public reference exposes only the cover, not dashboard frames |

## Figma evidence still needed

Provide full-resolution desktop frames (and mobile frames if mobile is in scope) for: login; populated and empty scheduled views; sent view with preview action; compose modal including CSV validation counts; Slack disconnected and connected states; loading, no-results, and error states. Without those frames, the current warm-gray Outbox Labs treatment can be reviewed functionally but cannot honestly be called pixel-perfect.
