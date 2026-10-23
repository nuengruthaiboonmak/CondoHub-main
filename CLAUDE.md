# CLAUDE.md

CondoHub: condo/residence management (resident portal + admin console). Optimize for correctness,
spec compliance, and consistency with existing patterns. Spec: `docs/superpowers/` (local-only).

## Stack (exact, do not introduce alternatives)

Next.js 16 App Router + React 19 + TS strict + Tailwind v4 (CSS-first, no config file) + Drizzle ORM
(`pg` driver, pool max 5) + Better Auth 1.7.7 (username login, DB sessions) + Socket.IO (in-process,
notify-only) + Supabase Postgres (pooler) + Supabase Storage via S3 API. Package manager: pnpm@10.26.1.
Forms: react-hook-form + Zod. Icons: lucide-react only. No Radix/shadcn/sonner/clsx/CVA, no date lib
(`Intl` + `Asia/Bangkok` from `src/config/project.ts`), no `any`.

## Architecture

- `src/modules/<module>/{domain,application,infrastructure,ui}/`: domain = pure policy + colocated
  `*.test.ts`; application = use cases (tx boundary), Zod route schemas, `index.ts` barrel; infrastructure
  = Drizzle schema + repositories; ui = `'use client'` components only.
- Cross-module access ONLY via another module's `application/` seams (never its `infrastructure/`
  except shared FK type refs; never cross-module tables). App pages may import only `modules/*/application`.
- `src/app/api/**`: `withApi` handler + `requireActiveActor`/`requireAdmin` first, Zod via
  `parseWithFieldErrors`, success `{data,meta?}`, errors via `toErrorEnvelope`, rate presets in
  `shared/utils/rateLimit`. No `if (role===...)` in handlers; policy objects decide.
- Pages: async server components, `import 'server-only'`, call use cases directly with actor (never HTTP).
  Client interactivity only in `ui/` components. No global store.
- Money on the wire: decimal string + `"currency": "THB"`. No float; bigint + decimal.js.
- Never advisory locks (pooler-unsafe). Single-process assumptions only (no Redis).

## Commands (run from repo root)

- `pnpm typecheck`, `pnpm build`, `pnpm test` (vitest, 347 tests), `pnpm e2e` (playwright, `e2e/`,
  needs prod server + `TEST_BASE_URL` + `E2E_RUN_ID` + `E2E_ADMIN_*`).
- `pnpm dev` / `pnpm start`: custom server (Next + Socket.IO, one port). Never `next dev` directly.
- `pnpm db:generate` then `pnpm db:migrate`. Migrations: one at a time, never parallel; additive only.
- Seed/reset/ops: `db:seed:bootstrap|e2e|reset|scenario|e2e-admin`, `billing:ops`, `maintenance:ops`,
  `chat:ops`. Seeds are script-only, `SEED_ENABLED=true`, never in production.

## Definition of Done

1. `pnpm typecheck` + `pnpm build` + `pnpm test` green. 2. New behavior has unit tests (domain colocated)
   and/or Playwright E2E on the real stack (real DB/S3/socket, `RUN_ID`-namespaced, zero residue after).
3. No mocks faking integrations. 4. Frontend work: browser-verified at 360/768/1366 (zero overflow),
   keyboard-walked, screenshots reviewed. 5. Reviews: 3 subagent reviewers, all PASS, before close.

## Conventions

- No code comments, ever. No emoji, no Thai in UI/code, no hex colors in tsx (tokens only).
- Every color via `src/styles/tokens.css` (`--ui-*` + `@theme inline`); light-only MVP (`color-scheme:
  light`, no `dark:`). Fonts: Inter + Noto Sans Thai via `next/font`.
- UI text: English, sentence case, concrete verb + object. Errors state what failed + next step.
- `data-testid="<screen>-<element>"` kebab-case on everything E2E touches; never remove/rename without
  updating `e2e/` first and re-running the suite.
- Forms: RHF + Zod, `noValidate`, field `role=alert` errors + `aria-invalid`, focus-first-invalid,
  server-error alert, `Button loading`, toast on success, `router.refresh()/push()`. Native controls only
  (`select`, `input[type=file|date|checkbox]`, `button`, `a`). Mutations send `Idempotency-Key`.
- Motion: opacity + transform only (never `transition-all` or layout props), 100-250ms ease-out,
  `prefers-reduced-motion` respected. No gradients, no glassmorphism, generous restraint.
- Errors: freeze `§2.4` codes only; private-resource denial = 404 concealment. Never invent codes/routes.
- Env: `.env.local` (gitignored); cite secret VALUES never — env-var names only, in chat/logs/reviews.

## File placement

New domain logic → owner module `domain/` + test. New use case → owner `application/` + barrel export.
New table → owner `infrastructure/schema.ts` + migration. New component → owner `modules/*/ui/` or
`src/shared/ui/` if used by 2+ modules. New page → `src/app/` route. Reuse first: grep for existing
helpers/components/seams before creating anything; one pattern per concern, repo-wide.

## Safe-change rules

- Do not touch migrations already applied to the test DB (additive follow-ups only).
- Do not touch `e2e/` contracts (testids, copy, routes, DOM shapes) unless the task explicitly says so —
  then update specs and re-run green in the same change.
- Do not rewire auth/session/socket/bootstrap singletons; do not add public signup; do not weaken gates.
- Backend slices: never invent routes/codes/columns beyond the frozen contracts without an ADR.
- Destructive ops (deletes, resets, force flags, killing shared servers) need explicit user approval;
  routine dev/test/seed/E2E commands are pre-authorized.

## Security

Secrets stay in `.env.local`; `.env.example` carries names only. Validate server-side always (client
validation is UX, not security). No sensitive data in logs/toasts/errors (redact PII, amounts where the
spec says so). Signed URLs only for private objects; never public buckets.

## Git

Concise English messages, no co-author trailer, no task/phase numbers. Never stage `.env.local`,
`.agent/`, or `docs/superpowers/` (local-only). Never `git add -f` those paths. No amend/push unless asked.