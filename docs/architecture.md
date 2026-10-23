# Architecture

CondoHub is a modular monolith built with Next.js App Router. One deployment serves one
condo project. All business rules live in eight domain modules under
`src/modules/<module>/`. The web layer (`src/app/`) is thin: async server components
call application use cases directly, and client components are confined to each
module's `ui/` directory.

## Module layout

Every module follows the same four-layer shape:

```
src/modules/<module>/
  domain/          Pure policy: no I/O, no framework imports.
                   Each rule file has a colocated *.test.ts.
  application/     Use cases (the transaction boundary), Zod route schemas,
                   and an index.ts barrel. This is the only seam other
                   modules may import from.
  infrastructure/  Drizzle schema and repositories. Never imported
                   cross-module, except shared foreign-key type references.
  ui/              'use client' components only. Server components live
                   in src/app/ and compose these.
```

Cross-module access goes through another module's `application/` barrel only.
Pages under `src/app/` may import only from `modules/*/application`. There are no
cross-module table joins; each module owns its tables.

## The eight modules

| Module | Owns | Key tables |
|---|---|---|
| `identity-access` | Usernames, passwords, sessions, provisioning, account lifecycle | `user`, `session`, `account`, `verification` (Better Auth schema) |
| `property-membership` | Buildings, floors, rooms, ownership intervals, tenancies, memberships | `building`, `floor`, `room`, `room_ownership`, `rental_period`, `room_membership` |
| `facility-booking` | Facilities, versioned booking rules, closures, bookings, quota ledger | `facility`, `facility_config`, `facility_closure`, `booking`, `booking_slot`, `quota_adjustment`, `quota_period_lock` |
| `billing-payments` | Billing rules, charge events, invoices, payment submissions, turnover reviews, payee instructions | `billing_rule`, `common_fee_charge_event`, `invoice`, `private_rent_invoice_reviewer`, `common_fee_invoice_responsible_owner`, `turnover_billing_review`, `turnover_review_responsible_owner`, `invoice_revision`, `payment_submission`, `payment_instruction` |
| `maintenance` | Repair tickets, recipients, status history, comments | `maintenance_request`, `maintenance_recipient`, `maintenance_status_history`, `maintenance_comment` |
| `announcements` | Project-wide notices, revisions, visibility | `announcement`, `announcement_revision` |
| `room-chat` | One continuous conversation per room, message visibility | `room_conversation`, `chat_message` |
| `media-attachments` | Image upload intents, verification, scope ACL, orphan sweep | `image_attachment` |

Shared kernel code lives in `src/shared/`: `auth/` (actor, route guards, API
wrapper), `db/` (client, transactions, audit, jobs, idempotency, job leases),
`storage/` (S3 client, object keys, presigned URLs), `utils/` (clock, money,
pagination, errors, rate limits), `ui/` (design-system primitives), and
`observability/` (logger, request IDs, audit writer). Project-wide singletons
(`src/config/project.ts`, auth instance, socket) are wired once in
`src/server/bootstrap.ts` and never re-created per request.

## Request flow

API routes under `src/app/api/**` follow an identical shape:

1. `withApi` wraps the handler (request ID, error envelope, rate limiting).
2. `requireActiveActor` (or `requireAdmin`) resolves the Better Auth session to
   an actor and rejects suspended or first-login accounts before any policy runs.
3. Input is parsed with `parseWithFieldErrors` against the module's Zod schema.
4. A policy object from `domain/` decides; the use case in `application/`
   executes inside a transaction.
5. Success returns `{ data, meta? }`; failures return `{ error: { code, message,
   fieldErrors?, requestId? } }` via `toErrorEnvelope`.

There are no `if (role === ...)` checks in handlers. Authorization lives in
domain policy functions (for example `canViewRoom`, invoice ACL matrices,
ticket visibility), which also perform 404 concealment: a private resource the
actor may not see returns `RESOURCE_NOT_FOUND`, never `ACCESS_DENIED`, so its
existence is not disclosed.

Pages are async server components (`import 'server-only'`, `dynamic =
'force-dynamic'` where data is per-actor). They call the same use cases with the
session actor rather than going through HTTP. Mutations from the browser use
`Idempotency-Key` headers; risky concurrent paths (booking slots, payment
review, config commit, turnover resolve) re-check versions or hold row locks
inside the transaction and answer `409` with codes such as `VERSION_CONFLICT`,
`BOOKING_SLOT_UNAVAILABLE`, or `PAYMENT_ALREADY_REVIEWED`.

## Data rules that shape the schema

* Time is stored as `timestamptz` in UTC. All business periods (booking slots,
  billing cycles, announcement visibility) are computed in the project timezone
  (`Asia/Bangkok` by default) through the single server `Clock`. Client
  timestamps are never trusted.
* Money is integer satang (`bigint`) in the database and a decimal string with
  `"currency": "THB"` on the wire. No floating point anywhere; area-based fees
  use decimal arithmetic rounded half-up to the satang per invoice line.
* History is append-only. Ownership, tenancies, and memberships are intervals;
  invoices carry immutable snapshots of reviewers, responsible owners, and payee
  instructions, so a later transfer never rewrites an already issued invoice.
  Nothing that records rights, money, bookings, or tickets is hard-deleted.
* Resource lifecycle is soft state: buildings, floors, rooms, and facilities
  deactivate (`deleted_at`) rather than disappear, and deactivation is blocked
  while active rentals, memberships, or bookings reference the resource.
* No advisory locks (the Supabase pooler forbids them) and no Redis. Quota and
  capacity checks use row locks and sorted access inside Postgres transactions,
  and Socket.IO runs in-process as a notify-only fan-out: HTTP fetch is the
  source of truth, socket events just tell the UI to refetch.

## Auth and sessions

Authentication is Better Auth 1.7.7 with email/password plus the username
plugin, backed by database sessions (7-day expiry). Usernames are the login
identity and are immutable; email is required but never verified in this
deployment. There is no public signup. Accounts move through
`PROVISIONED` to `FIRST_LOGIN_REQUIRED` (one-time temporary password, forced
change on first login) to `ACTIVE`, with `SUSPENDED` and `RESET_REQUIRED` as
administrative states. Password change, reset, and suspension revoke all of the
account's sessions and socket connections. Room-scoped provisioning lets an
admin create project-managed tenants, while current owners create private
tenants and co-owners in their own rooms.

## Realtime

`src/server/socket.ts` authenticates the handshake against the session, gates
room joins through `authorizeRoomJoin`, and emits `chat.message.created` plus
`access.revoked` (which carries no content). Persistence happens first via
`POST /api/rooms/:id/messages` with an idempotent `clientMessageId`; the
socket only announces. Message visibility is temporal: a message is visible to
a reader only when it was sent inside one of the reader's own eligibility
intervals, so residents who move out keep their history but gain nothing new.

## Background work

Recurring billing runs through invoice-generation jobs triggered by an internal
endpoint guarded with `JOB_TRIGGER_SECRET`. Jobs are idempotent (business keys
plus unique constraints), resume with cursors, and record runs surfaced at
`/admin/billing/job-runs`. Derived states such as overdue invoices need no
cron: `OVERDUE` is computed at read time from the day after `dueDate`.
Orphaned image uploads are swept by a similar internal job.
