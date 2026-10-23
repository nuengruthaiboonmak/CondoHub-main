# Operations

## Deployment model

There is no Dockerfile, compose file, or CI pipeline in this repository.
Deployment is manual: build the Next.js app, run migrations separately from
server startup, and run the custom server (`src/server/index.ts`) as a
long-lived Node process on `$PORT` (commonly behind a TLS-terminating proxy).

```bash
pnpm install
pnpm db:migrate        # separate step, before the new code serves traffic
pnpm build
pnpm start             # Next.js + Socket.IO on one port
```

Keep auto-deploy off. The runtime dependencies are Supabase Postgres
(accessed through the Session Pooler IPv4 URL in `DATABASE_URL`), Supabase
Storage through its S3-compatible endpoint, and the Node process itself.
There is no Redis and no separate worker tier: Socket.IO runs in-process and
billing jobs are triggered over HTTPS.

Configure the host with `NODE_ENV=production`, `SEED_ENABLED` unset or
`false`, a real `BETTER_AUTH_SECRET` and `JOB_TRIGGER_SECRET`, and the
production `DATABASE_URL` and S3 credentials. Security headers (CSP extended
with the S3 host, `nosniff`, `DENY` framing, a restrictive
`Permissions-Policy`, and HSTS) are set in `next.config.ts`.

## Recurring billing

Common-fee and rent invoicing for a cycle is produced by the
`generate-invoices` internal job, not by user requests. Trigger it with the
job secret:

```bash
curl -X POST "$APP_BASE_URL/api/internal/jobs/generate-invoices" \
  -H "x-job-secret: $JOB_TRIGGER_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"triggerSource":"MANUAL","fromCycle":"2026-10","toCycle":"2026-10"}'
```

The job is idempotent: business keys plus unique constraints make retries
safe, cursors let a partial run resume, and every run is recorded. Review run
history at `/admin/billing/job-runs` (list) and `/admin/billing/job-runs/[id]`
(detail). Scheduling itself is external; the reference setup calls this
endpoint from Supabase `pg_cron`/`pg_net` on the required cadence, with a
catch-up invocation after any outage. Overdue state needs no scheduler: an
invoice with outstanding balance becomes `OVERDUE` automatically the day after
its due date at read time.

One-time charges (for example a lobby renovation contribution) follow a
different path: an admin creates a charge event at
`/admin/billing/events/new`, confirms the room audience on the event detail
page, and issues invoices in batches of at most 25 rooms. Issuance is
resumable: retrying continues with the remaining rooms, and already created
invoices are never duplicated. Cancelling an event stops further issuance but
leaves issued invoices standing.

## Orphaned uploads

Image uploads are two-phase (presigned PUT, then server verification). Anything
abandoned between the phases is reclaimed by the sweep job:

```bash
curl -X POST "$APP_BASE_URL/api/internal/jobs/sweep-orphans" \
  -H "x-job-secret: $JOB_TRIGGER_SECRET"
```

Unverified intents expire after 30 minutes, verified-but-unattached images
after 24 hours. The E2E teardown also purges its namespace prefix directly.

## Operator scripts

`billing:ops`, `maintenance:ops`, and `chat:ops` are the supported way to
inspect production-shaped state without touching the database by hand. They
are read-only probes except for the explicitly mutating billing subcommands
(`issue-event`, `hold-lease`, `add-member`), print JSON, and refuse to run
unless `SEED_ENABLED=true` in a non-production `NODE_ENV`, so point them at
the right environment file before use. Typical session:

```bash
SEED_ENABLED=true pnpm billing:ops probe-review --room <roomId> --month 2026-10
SEED_ENABLED=true pnpm billing:ops probe-payments --invoice <invoiceId>
SEED_ENABLED=true pnpm maintenance:ops probe-ticket --ticket <ticketId>
SEED_ENABLED=true pnpm chat:ops probe-conversation --room <roomId>
```

## Backups and recovery

Backups are the Supabase project's responsibility: enable point-in-time
recovery on the database and versioning or scheduled backups on the storage
bucket holding payment slips, QR codes, chat images, maintenance photos, and
announcement images (all under private buckets, addressed by server-generated
UUID keys). Application state needed to reconcile money after a restore is
the `invoice`, `payment_submission`, `turnover_billing_review`, and
`common_fee_charge_event` tables plus the `audit` log; re-running
`generate-invoices` for the affected cycle after a restore converges without
duplicates thanks to idempotency keys.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Login loops back to `/login` | Session cookie missing or `BETTER_AUTH_URL` mismatched with the public URL. Check the proxy preserves host and cookies. |
| `FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED` on every request | The account still has `mustChangePassword`. Complete `/change-password` (minimum 12 characters). |
| Images fail to upload or render | S3 credentials or bucket wrong, or the file is not JPEG/PNG/WebP within the byte cap (10 MB slips, 5 MB everything else). `GET /api/health` reports `s3` status. |
| Invoices missing for a month | The generation job has not run or errored for that cycle. Check `/admin/billing/job-runs`, then trigger the job manually and re-check. Multi-tenancy months stay `UNRESOLVED` in the turnover queue until someone resolves them; that is by design, not an error. |
| Socket connects but no live updates | The handshake requires a valid non-suspended session; the UI refetches over HTTP anyway, so a missed event only delays, never loses, data. Restarting the Node process drops in-memory room membership only; clients rejoin. |
| `VERSION_CONFLICT` / `CONFIG_IMPACT_CHANGED` on save | Someone else changed the same ticket, invoice, or facility config first. Reload and re-apply; the preview shows what moved. |
| `RATE_LIMITED` on login | Five attempts per 15 minutes per key. Wait, or check for a credential-stuffing pattern in the logs before raising the `login` bucket. |

Health is a single endpoint: `GET /api/health` returns DB and S3 reachability
plus build version and uptime, suitable for load-balancer checks.
