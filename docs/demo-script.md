# Demo script (under five minutes)

Prepare before recording: keep exactly one HTTPS tunnel and guarded app running, connect Slack only to `scheduler-alert`, run `DEMO_SENDER_POSITION=1 npm run demo:configure-rate-limit`, and ensure its safety check reports zero current-hour consumption. Use `slack-rate-limit-demo.csv` and a distinctive subject such as `ReachInbox rate-limit demo <timestamp>`.

1. **Google login and ownership — 30 seconds.** Open the public HTTPS origin, sign in with Google, and show the identity plus two owner-scoped Ethereal senders. Mention that OAuth/session and SMTP credentials are encrypted or server-side and never returned to the browser.
2. **CSV scheduling — 55 seconds.** Open Compose, upload `slack-rate-limit-demo.csv`, show three valid unique `example.com` recipients, choose the cap-2 sender, use a start about one minute ahead and five-second spacing, then schedule. Show the effective UTC-backed time and campaign cap 2.
3. **Persistence — 35 seconds.** With the second sender, schedule one future email. Show its delayed BullMQ job, restart only API/worker (`docker compose -f docker-compose.prod.yml restart api worker` in production), and show one later `SENT` result with one Ethereal preview. Refresh again to show terminal messages were not resent.
4. **Delivery and rate limit — 70 seconds.** Show two `SENT` rows with at least five seconds between their recorded send times and open an Ethereal Preview. Show the third row still scheduled at the next real UTC-hour boundary with `sender-hourly-limit` as its reason.
5. **Slack — 30 seconds.** Show `AB work → #scheduler-alert` in ReachInbox, then the one real limit alert in that channel. State that the stored event and webhook each have one successful attempt; refresh to show deferral did not create another alert.
6. **Search and queues — 40 seconds.** Search the distinctive subject in Elasticsearch-backed dashboard results and show the sent status. Open `/admin/queues` while signed in as an `ADMIN_EMAILS` user and point out email, index, and Slack queues.
7. **Independent sender and semantics — 30 seconds.** Schedule one safe message with the second sender to show quotas are independent. Close by noting that confirmed `SENT` rows are terminal and ambiguous SMTP outcomes are not blindly retried.

The sender-cap helper changes only the selected sender's database cap. It refuses non-zero current-hour consumption and never deletes or rewrites Redis quota keys. The real hour is never shortened for the demo.
