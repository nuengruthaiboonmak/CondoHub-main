# CondoHub

CondoHub is a web application for running a residential condo project: one
deployment serves one building complex, giving its administrator, its owners,
and its residents a shared workspace for rooms and people, facility bookings,
billing and payments, repair tickets, announcements, and room chat.

![Resident home dashboard](docs/images/home-dashboard.png)

Residents see what needs their attention (bills due, open repairs, upcoming
bookings, community updates). Owners manage their rooms, tenancies, rent, and
repairs. Administrators run buildings, facilities, users, announcements,
project billing, and the common-area maintenance inbox.

## A look inside

Room workspace with owners, members, and rental status.

![Room detail with owners and members](docs/images/room-detail.png)

Facility booking with live slot availability and per-room quota.

![Facility detail with available slots](docs/images/facility-detail.png)

Owner rental management with tenants, rent setup, and repairs.

![Rental management for a room](docs/images/room-rental.png)

Administration view of a building with its floors and rooms.

![Building detail with floors and rooms](docs/images/admin-building-detail.png)

Repair ticket handling with history and discussion.

![Repair ticket in the admin inbox view](docs/images/admin-ticket-detail.png)

## Features

| Area | What it does |
|---|---|
| Rooms and people | Buildings, floors, and rooms with readable names; ownership intervals; tenancies (project-managed or private-owner-managed); member roles; full history for former residents and owners. |
| Facility booking | Weekly opening schedules, closures, fixed slots, capacity limits, and per-room quotas with an audited refund ledger; all-or-nothing multi-slot booking. |
| Billing and payments | Common-fee and rent invoicing in THB; one-time charge events with resumable room-by-room issuance; slip-based payment review with partial approvals; turnover queue for months with mid-cycle tenant changes. |
| Repairs | Common-area and room tickets with photo attachments, comments, and a strict state machine; private-owner tickets stay invisible to administration. |
| Announcements | Project-wide notices with images, drafts, scheduling, and an explicit hide/restore record. |
| Room chat | One continuous conversation per room with temporal visibility, image messages, and live updates over in-process Socket.IO. |
| Accounts | Username login, room-scoped provisioning, forced password change on first login, suspension with instant session and socket revocation. |

Details for everyday use are in [docs/user-guide.md](docs/user-guide.md),
including the API overview and the frozen error-code table.

## Quick start

Prerequisites: Node.js, `pnpm@10.26.1`, and access to a Supabase project
(Postgres plus Storage) for the development database.

```bash
pnpm install
cp .env.example .env.local   # fill in real values, see docs/development.md
pnpm db:migrate
pnpm db:seed:bootstrap       # creates the first admin (username `admin`)
pnpm dev                     # app + realtime on http://localhost:3000
```

Sign in at `http://localhost:3000/login`. The bootstrap account must set a
new password on first login. Never run `next dev` directly; always use the
custom server commands above.

## Tech stack

Exact versions are pinned in `package.json`:

* Next.js 16 App Router with React 19 and strict TypeScript
* Tailwind CSS v4 (CSS-first, tokens in `src/styles/tokens.css`), lucide icons
* Drizzle ORM over Supabase Postgres (pooler, pool max 5)
* Better Auth 1.7.7 with username login and database sessions
* Socket.IO in the same Node process (notify-only; HTTP is the source of truth)
* Supabase Storage through the S3 API for private image buckets
* react-hook-form plus Zod for forms; decimal.js for money math
* Vitest for unit tests; Playwright for end-to-end tests

There is deliberately no Redis, no date library (`Intl` with
`Asia/Bangkok`), no component framework beyond the project's own primitives
in `src/shared/ui/`, and no `any` in TypeScript.

## Project structure

```
src/
  app/                 Routes: (resident) workspace, admin console, auth pages,
                       and api/ handlers (thin: guard, parse, use case, envelope)
  modules/<module>/    domain/ (pure policy + colocated tests)
                       application/ (use cases, Zod schemas, index.ts barrel)
                       infrastructure/ (Drizzle schema + repositories)
                       ui/ ('use client' components)
  shared/              auth, db, storage, utils, ui primitives, observability
  config/              project constants (timezone, currency) and env validation
  server/              custom server entrypoint (Next + Socket.IO, one port)
scripts/               migrate, seeds, scenario fixtures, billing/maintenance/chat ops,
                       docs screenshot tooling
e2e/                   Playwright suite against the real stack (DB, S3, sockets)
drizzle/               versioned SQL migrations (additive, one at a time)
docs/                  architecture, development, operations, user guide, screenshots
```

Cross-module imports go through `application/` barrels only. Pages import only
from `modules/*/application`. Each module owns its tables.

## Documentation

* [docs/architecture.md](docs/architecture.md): modules, request flow,
  data rules, auth and sessions, realtime, background jobs
* [docs/development.md](docs/development.md): setup, environment variables,
  everyday commands, database and seed workflow, testing, code conventions
* [docs/operations.md](docs/operations.md): deployment, recurring billing,
  orphan sweep, operator scripts, backups, troubleshooting
* [docs/user-guide.md](docs/user-guide.md): roles, workflows, API overview,
  error codes, limits

## Quality gates

* `pnpm typecheck`, `pnpm build`, and `pnpm test` (400 tests across 58 files)
  are green.
* New behavior ships with unit tests next to the domain code and, where it
  touches a user flow, Playwright coverage on the real stack with zero residue
  afterwards. Integrations are never mocked.
* Frontend changes are verified in a browser at 360, 768, and 1366 px widths,
  keyboard-walked, and screenshot-reviewed.

## Security model

* Default deny: every route resolves the session actor first and every query
  is scoped before counting or paginating.
* Private resources answer 404 (never 403), so their existence is not leaked.
* Only JPEG, PNG, and WebP images within strict byte caps; uploads are
  verified server-side and served through scoped presigned URLs.
* Secrets stay in `.env.local`; validation always runs server-side; logs and
  errors never carry credentials, PII, or amounts where the spec forbids them.
