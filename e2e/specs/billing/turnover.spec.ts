import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { addDaysProjectDate, projectToday } from '../../helpers/dates';
import {
  completeFirstLogin,
  loginAsAdmin,
  loginAsUser,
  provisionUser,
  roomOwnerAt,
  signInSuspendedActor,
} from '../../helpers/owner';
import { provisionResidentWithRetry } from '../../helpers/resident';
import {
  findBillingRoom,
  getTurnoverReview,
  listInvoices,
  listTurnoverReviews,
  postTurnoverResolve,
  triggerGenerate,
  type ErrorEnvelope,
  type ResolveTurnoverEnvelope,
} from './billingFlow';

interface ProbeTurnoverInvoice {
  id: string;
  tenancyId: string;
  kind: string;
  periodStart: string;
  dueDate: string;
  totalAmount: string;
  reviewerSnapshotSource: string | null;
  pastDueDateConfirmed: boolean | null;
  payee: { bankName: string; accountName: string; accountNumber: string } | null;
}

interface ProbeTurnoverResult {
  reviewId: string;
  review: { state: string; version: number; decisionType: string | null; reason: string | null };
  invoices: ProbeTurnoverInvoice[];
  reviewers: Array<{ invoiceId: string; userId: string }>;
}

interface ProbeAuditResult {
  resourceId: string;
  entries: Array<{ action: string; resourceType: string; after: unknown }>;
}

async function runBillingOps(args: string[]): Promise<string> {
  const root = path.resolve(__dirname, '..', '..', '..');
  return new Promise<string>((resolve, reject) => {
    const child = spawn('pnpm', ['billing:ops', ...args], {
      cwd: root,
      shell: process.platform === 'win32',
      env: process.env,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number) => {
      if (code !== 0) {
        reject(new Error(`billing:ops ${args.join(' ')} exited ${code}: ${output}`));
        return;
      }
      const line = output
        .split('\n')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith('{'));
      if (line === undefined) throw new Error('billing:ops printed no result.');
      resolve(line);
    });
  });
}

async function probeTurnover(reviewId: string): Promise<ProbeTurnoverResult> {
  return JSON.parse(await runBillingOps(['probe-turnover', '--', '--review', reviewId])) as ProbeTurnoverResult;
}

async function probeAudit(resourceId: string): Promise<ProbeAuditResult> {
  return JSON.parse(await runBillingOps(['probe-audit', '--', '--resource', resourceId])) as ProbeAuditResult;
}

async function backdatedTransfer(
  page: Page,
  input: { roomId: string; fromUserId: string; toUserId: string; effectiveAt: string },
): Promise<void> {
  const transferred = await apiJson<{ data: { endedOwnershipId: string } }>(page.request, {
    method: 'POST',
    path: `/api/admin/rooms/${input.roomId}/ownerships`,
    body: {
      action: 'TRANSFER',
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      effectiveAt: input.effectiveAt,
    },
  });
  expect(transferred.status).toBe(200);
}

interface TurnoverCtx {
  freshA: { userId: string; username: string; password: string };
  freshB: { userId: string; username: string; password: string };
  original206CoOwner: string;
  review206: string;
  review207: string;
  review208: string;
  review209: string;
  tenancies206: [string, string];
  tenancies207: [string, string];
  tenancies208: [string, string];
}

const ctx: Partial<TurnoverCtx> = {};

function ownerUsername(runId: string, workerIndex: number, stem: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `e2e${suffix}${stem}${workerIndex}`.slice(0, 30);
}

function ownerPassword(runId: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `Owner-${suffix}-pw1`;
}

async function openOwnerPage(browser: Browser, baseURL: string, username: string, password: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL });
  const userPage = await context.newPage();
  await loginAsUser(userPage, username, password);
  return { page: userPage, close: () => context.close() };
}

test.describe('billing turnover: queue, resolve, concealment, ms-bill-08', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180000);

  test('setup: backdated owners plus june generation yields four turnover reviews', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room206 = await findBillingRoom(page, `E2E-${runId}-206`);
    const room207 = await findBillingRoom(page, `E2E-${runId}-207`);
    const room208 = await findBillingRoom(page, `E2E-${runId}-208`);
    const room209 = await findBillingRoom(page, `E2E-${runId}-209`);

    const usernameA = ownerUsername(runId, testInfo.workerIndex, 'turna');
    const usernameB = ownerUsername(runId, testInfo.workerIndex, 'turnb');
    const password = ownerPassword(runId);
    const provisionedA = await provisionUser(page, { username: usernameA, name: `Turnover A ${runId}` });
    const provisionedB = await provisionUser(page, { username: usernameB, name: `Turnover B ${runId}` });
    const contextA = await browser.newContext({ baseURL });
    const pageA = await contextA.newPage();
    const contextB = await browser.newContext({ baseURL });
    const pageB = await contextB.newPage();
    try {
      await completeFirstLogin(pageA, { username: usernameA, tempPassword: provisionedA.tempPassword, newPassword: password });
      await completeFirstLogin(pageB, { username: usernameB, tempPassword: provisionedB.tempPassword, newPassword: password });
      ctx.freshA = { userId: provisionedA.userId, username: usernameA, password };
      ctx.freshB = { userId: provisionedB.userId, username: usernameB, password };

      const ownersBefore = await apiJson<{ data: { owners: Array<{ userId: string }> } }>(page.request, {
        method: 'GET',
        path: `/api/rooms/${room206}`,
      });
      expect(ownersBefore.status).toBe(200);
      const transferred206 = await roomOwnerAt(page, room206);
      const coOwner206 = ownersBefore.json.data.owners.map((owner) => owner.userId).find((id) => id !== transferred206);
      expect(coOwner206).toBeDefined();
      ctx.original206CoOwner = coOwner206 ?? '';

      await backdatedTransfer(page, {
        roomId: room206,
        fromUserId: transferred206,
        toUserId: provisionedA.userId,
        effectiveAt: '2026-05-15T00:00:00.000Z',
      });
      await backdatedTransfer(page, {
        roomId: room207,
        fromUserId: await roomOwnerAt(page, room207),
        toUserId: provisionedA.userId,
        effectiveAt: '2026-05-15T00:00:00.000Z',
      });

      const june = await triggerGenerate(page.request, {
        triggerSource: 'MANUAL',
        fromCycle: '2026-06',
      });
      expect(june.json.data.caughtUp).toBe(true);
      expect(june.json.data.created).toBeGreaterThanOrEqual(7);
      expect(june.json.data.reviewRequired).toBeGreaterThanOrEqual(2);

      const ownerQueue = await listTurnoverReviews(pageA.request, {});
      const byRoom = new Map(ownerQueue.rows.map((row) => [row.roomId, row]));
      expect(byRoom.has(room206)).toBe(true);
      expect(byRoom.has(room207)).toBe(true);
      expect(ownerQueue.unresolvedCount).toBe(2);
      const review206 = byRoom.get(room206);
      const review207 = byRoom.get(room207);
      expect(review206?.state).toBe('UNRESOLVED');
      expect(review206?.version).toBe(1);
      expect(review206?.blocked).toBe(false);
      expect(review206?.candidateTenancyIds).toHaveLength(2);
      expect(review207?.candidateTenancyIds).toHaveLength(2);
      ctx.review206 = review206?.id ?? '';
      ctx.review207 = review207?.id ?? '';
      ctx.tenancies206 = [review206?.candidateTenancyIds[0] ?? '', review206?.candidateTenancyIds[1] ?? ''];
      ctx.tenancies207 = [review207?.candidateTenancyIds[0] ?? '', review207?.candidateTenancyIds[1] ?? ''];

      const adminQueue = await listTurnoverReviews(page.request, {});
      const adminByRoom = new Map(adminQueue.rows.map((row) => [row.roomId, row]));
      expect(adminByRoom.has(room206)).toBe(false);
      expect(adminByRoom.has(room207)).toBe(false);
      expect(adminByRoom.has(room208)).toBe(true);
      expect(adminByRoom.has(room209)).toBe(true);
      const review208 = adminByRoom.get(room208);
      const review209 = adminByRoom.get(room209);
      expect(review209?.blocked).toBe(true);
      expect(review209?.managementModeAtCreation).toBe('PROJECT_MANAGED');
      expect(review208?.blocked).toBe(false);
      ctx.review208 = review208?.id ?? '';
      ctx.review209 = review209?.id ?? '';
      ctx.tenancies208 = [review208?.candidateTenancyIds[0] ?? '', review208?.candidateTenancyIds[1] ?? ''];
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('ui: queues, badges, and detail pages render per scope', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const freshA = ctx.freshA;
    expect(freshA).toBeDefined();

    await page.goto('/admin/billing/turnover-reviews');
    await expect(page.getByTestId('turnover-review-list-page')).toBeVisible();
    await expect(page.getByTestId(`turnover-review-row-${ctx.review208 ?? ''}`)).toBeVisible();
    await expect(page.getByTestId(`turnover-review-blocked-${ctx.review209 ?? ''}`)).toHaveText('Blocked');
    await expect(page.getByTestId(`turnover-review-row-${ctx.review206 ?? ''}`)).toHaveCount(0);
    await expect(page.getByTestId('turnover-review-unresolved-indicator')).toContainText('unresolved');
    await page.getByTestId('turnover-review-filter-resolved').click();
    await expect(page.getByTestId(`turnover-review-row-${ctx.review208 ?? ''}`)).toHaveCount(0);
    await page.getByTestId('turnover-review-filter-unresolved').click();
    await expect(page.getByTestId(`turnover-review-row-${ctx.review208 ?? ''}`)).toBeVisible();
    await page.getByTestId(`turnover-review-row-${ctx.review208 ?? ''}`).click();
    await expect(page.getByTestId('turnover-review-detail-page')).toBeVisible();
    await expect(page.getByTestId('turnover-review-detail-state')).toHaveText('Unresolved');
    await expect(page.getByTestId('turnover-resolve-form')).toBeVisible();

    const sessionA = await openOwnerPage(browser, baseURL, freshA?.username ?? '', freshA?.password ?? '');
    try {
      await sessionA.page.goto('/invoices/turnover-reviews');
      await expect(sessionA.page.getByTestId('owner-turnover-review-list-page')).toBeVisible();
      await expect(sessionA.page.getByTestId(`owner-turnover-review-row-${ctx.review206 ?? ''}`)).toBeVisible();
      await expect(sessionA.page.getByTestId('owner-turnover-review-unresolved-indicator')).toContainText('2 unresolved');
      await sessionA.page.goto('/');
      await expect(sessionA.page.getByTestId('home-page')).toBeVisible();
      await expect(sessionA.page.getByTestId('turnover-unresolved-badge')).toContainText('2 unresolved turnover reviews');
      await sessionA.page.goto('/invoices/turnover-reviews');
      await sessionA.page.getByTestId(`owner-turnover-review-row-${ctx.review206 ?? ''}`).click();
      await expect(sessionA.page.getByTestId('owner-turnover-review-detail-page')).toBeVisible();
      await expect(sessionA.page.getByTestId('turnover-review-detail-state')).toHaveText('Unresolved');
      await expect(sessionA.page.getByTestId('turnover-resolve-form')).toBeVisible();
    } finally {
      await sessionA.close();
    }

    const outsider = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'turnuiout',
      baseURL,
    });
    try {
      await outsider.page.goto('/invoices/turnover-reviews');
      await expect(outsider.page.getByTestId('owner-turnover-review-list-page')).toBeVisible();
      await expect(outsider.page.getByTestId('owner-turnover-review-list-empty')).toBeVisible();
      await outsider.page.goto('/');
      await expect(outsider.page.getByTestId('home-page')).toBeVisible();
      await expect(outsider.page.getByTestId('turnover-unresolved-badge')).toHaveCount(0);
      await outsider.page.goto(`/invoices/turnover-reviews/${ctx.review206 ?? ''}`);
      await expect(outsider.page.getByTestId('owner-turnover-review-list-page')).toBeVisible();
      await expect(outsider.page.getByTestId('owner-turnover-review-detail-page')).toHaveCount(0);
    } finally {
      await outsider.close();
    }
  });

  test('MS-BILL-08 plus EX1: former owner resolves after transfer with original snapshot and payee', async ({
    page,
    browser,
  }) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room206 = await findBillingRoom(page, `E2E-${runId}-206`);
    const freshA = ctx.freshA;
    const freshB = ctx.freshB;
    expect(freshA).toBeDefined();
    expect(freshB).toBeDefined();

    const sessionA = await openOwnerPage(browser, baseURL, freshA?.username ?? '', freshA?.password ?? '');
    const sessionB = await openOwnerPage(browser, baseURL, freshB?.username ?? '', freshB?.password ?? '');
    try {
      await backdatedTransfer(page, {
        roomId: room206,
        fromUserId: freshA?.userId ?? '',
        toUserId: freshB?.userId ?? '',
        effectiveAt: new Date().toISOString(),
      });

      const queueB = await listTurnoverReviews(sessionB.page.request, {});
      expect(queueB.rows).toHaveLength(0);
      expect(queueB.unresolvedCount).toBe(0);
      const concealedB = await apiJson<ErrorEnvelope>(sessionB.page.request, {
        method: 'GET',
        path: `/api/billing/turnover-reviews/${ctx.review206 ?? ''}`,
      });
      expect(concealedB.status).toBe(404);
      expect(concealedB.json.error.code).toBe('RESOURCE_NOT_FOUND');
      const resolveB = await postTurnoverResolve(sessionB.page.request, ctx.review206 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: 'Intruder attempt.',
        expectedVersion: 1,
      });
      expect(resolveB.status).toBe(404);
      expect((resolveB.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

      const concealedAdmin = await apiJson<ErrorEnvelope>(page.request, {
        method: 'GET',
        path: `/api/billing/turnover-reviews/${ctx.review206 ?? ''}`,
      });
      expect(concealedAdmin.status).toBe(404);
      expect(concealedAdmin.json.error.code).toBe('RESOURCE_NOT_FOUND');

      const queueA = await listTurnoverReviews(sessionA.page.request, {});
      expect(queueA.rows.some((row) => row.id === (ctx.review206 ?? ''))).toBe(true);

      const futureDue = addDaysProjectDate(projectToday(), 30);
      const tenancyA = ctx.tenancies206?.[0] ?? '';
      const tenancyB = ctx.tenancies206?.[1] ?? '';
      await sessionA.page.goto(`/invoices/turnover-reviews/${ctx.review206 ?? ''}`);
      await expect(sessionA.page.getByTestId('turnover-resolve-form')).toBeVisible();
      await sessionA.page.getByTestId('turnover-resolve-submit').click();
      await expect(sessionA.page.getByTestId('turnover-resolve-selection-error')).toBeVisible();
      await sessionA.page.getByTestId(`turnover-resolve-select-${tenancyA}`).check();
      await sessionA.page.getByTestId('turnover-resolve-submit').click();
      await expect(sessionA.page.getByTestId(`turnover-resolve-due-${tenancyA}`)).toHaveAttribute('aria-invalid', 'true');
      await expect(sessionA.page.getByTestId(`turnover-resolve-due-${tenancyA}`)).toBeFocused();
      await sessionA.page.getByTestId(`turnover-resolve-due-${tenancyA}`).fill('2026-06-05');
      await expect(sessionA.page.getByTestId(`turnover-resolve-past-warning-${tenancyA}`)).toBeVisible();
      await sessionA.page.getByTestId(`turnover-resolve-confirm-${tenancyA}`).check();
      await sessionA.page.getByTestId(`turnover-resolve-select-${tenancyB}`).check();
      await sessionA.page.getByTestId(`turnover-resolve-due-${tenancyB}`).fill(futureDue);
      await expect(sessionA.page.getByTestId(`turnover-resolve-override-${tenancyB}`)).toHaveCount(0);
      await sessionA.page.getByTestId('turnover-resolve-submit').focus();
      await sessionA.page.keyboard.press('Enter');
      await expect(sessionA.page.getByTestId('turnover-review-detail-state')).toHaveText('Resolved', { timeout: 15000 });
      await expect(sessionA.page.getByTestId('turnover-resolve-form')).toHaveCount(0);

      const resolved = await getTurnoverReview(sessionA.page.request, ctx.review206 ?? '');
      expect(resolved.state).toBe('RESOLVED');
      expect(resolved.version).toBe(2);
      expect(resolved.invoiceIds).toHaveLength(2);

      const probed = await probeTurnover(ctx.review206 ?? '');
      expect(probed.review.state).toBe('RESOLVED');
      expect(probed.review.version).toBe(2);
      expect(probed.review.decisionType).toBe('ISSUE_INVOICES');
      expect(probed.invoices).toHaveLength(2);
      for (const invoice of probed.invoices) {
        expect(invoice.kind).toBe('PRIVATE_RENT');
        expect(invoice.periodStart.startsWith('2026-06-01')).toBe(true);
        expect(invoice.totalAmount).toBe('1200000');
        expect(invoice.reviewerSnapshotSource).toBe('TURNOVER_REVIEW');
        expect(invoice.payee?.accountNumber).toBe('206-0-00001-9');
        expect(invoice.payee?.accountName).toBe('Amara Original Owner');
      }
      const backdated = probed.invoices.find((invoice) => invoice.dueDate.startsWith('2026-06-05'));
      const current = probed.invoices.find((invoice) => !invoice.dueDate.startsWith('2026-06-05'));
      expect(backdated?.pastDueDateConfirmed).toBe(true);
      expect(current?.pastDueDateConfirmed).toBe(false);
      const reviewerSets = new Map<string, string[]>();
      for (const entry of probed.reviewers) {
        const list = reviewerSets.get(entry.invoiceId) ?? [];
        list.push(entry.userId);
        reviewerSets.set(entry.invoiceId, list);
      }
      expect(reviewerSets.size).toBe(2);
      const expectedS1b = [freshA?.userId ?? '', ctx.original206CoOwner ?? ''].sort();
      for (const userIds of reviewerSets.values()) {
        expect([...userIds].sort()).toEqual(expectedS1b);
        expect(userIds).not.toContain(freshB?.userId ?? '');
      }

      const queueAfter = await listTurnoverReviews(sessionA.page.request, { state: 'UNRESOLVED' });
      expect(queueAfter.rows.some((row) => row.id === (ctx.review206 ?? ''))).toBe(false);
      const resolvedFilter = await listTurnoverReviews(sessionA.page.request, { state: 'RESOLVED' });
      expect(resolvedFilter.rows.some((row) => row.id === (ctx.review206 ?? ''))).toBe(true);
    } finally {
      await sessionA.close();
      await sessionB.close();
    }
  });

  test('past guard: backdated due date without confirmation is rejected with zero side effects', async ({
    page,
    browser,
  }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const freshA = ctx.freshA;
    expect(freshA).toBeDefined();
    const sessionA = await openOwnerPage(browser, baseURL, freshA?.username ?? '', freshA?.password ?? '');
    try {
      const rejected = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'ISSUE_INVOICES',
        selectedTenancyIds: ctx.tenancies207 ?? [],
        perInvoice: [
          { tenancyId: ctx.tenancies207?.[0] ?? '', dueDate: '2026-06-05' },
          { tenancyId: ctx.tenancies207?.[1] ?? '', dueDate: addDaysProjectDate(projectToday(), 30) },
        ],
        expectedVersion: 1,
      }, randomUUID());
      expect(rejected.status).toBe(400);
      expect((rejected.json as ErrorEnvelope).error.code).toBe('PAST_DUE_DATE_CONFIRMATION_REQUIRED');

      const detail = await getTurnoverReview(sessionA.page.request, ctx.review207 ?? '');
      expect(detail.state).toBe('UNRESOLVED');
      expect(detail.version).toBe(1);
      const probed = await probeTurnover(ctx.review207 ?? '');
      expect(probed.review.state).toBe('UNRESOLVED');
      expect(probed.invoices).toHaveLength(0);
      expect(probed.reviewers).toHaveLength(0);
    } finally {
      await sessionA.close();
    }
  });

  test('resolve negatives: split breaches, private override, bad keys, and concealment fail closed', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const freshA = ctx.freshA;
    expect(freshA).toBeDefined();
    const sessionA = await openOwnerPage(browser, baseURL, freshA?.username ?? '', freshA?.password ?? '');
    try {
      const futureDue = addDaysProjectDate(projectToday(), 30);
      const emptyIssue = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'ISSUE_INVOICES',
        selectedTenancyIds: [],
        perInvoice: [],
        expectedVersion: 1,
      });
      expect(emptyIssue.status).toBe(400);
      expect((emptyIssue.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

      const nonCandidate = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'ISSUE_INVOICES',
        selectedTenancyIds: [randomUUID()],
        perInvoice: [{ tenancyId: ctx.tenancies207?.[0] ?? '', dueDate: futureDue }],
        expectedVersion: 1,
      });
      expect(nonCandidate.status).toBe(400);
      expect((nonCandidate.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

      const skewed = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'ISSUE_INVOICES',
        selectedTenancyIds: ctx.tenancies207 ?? [],
        perInvoice: [{ tenancyId: ctx.tenancies207?.[0] ?? '', dueDate: futureDue }],
        expectedVersion: 1,
      });
      expect(skewed.status).toBe(400);
      expect((skewed.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

      const privateOverride = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'ISSUE_INVOICES',
        selectedTenancyIds: ctx.tenancies207 ?? [],
        perInvoice: [
          {
            tenancyId: ctx.tenancies207?.[0] ?? '',
            dueDate: futureDue,
            amountOverride: { amount: '9999.00', currency: 'THB' },
            overrideReason: 'Private actor must not override.',
          },
          { tenancyId: ctx.tenancies207?.[1] ?? '', dueDate: futureDue },
        ],
        expectedVersion: 1,
      });
      expect(privateOverride.status).toBe(403);
      expect((privateOverride.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');

      const malformedKey = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: 'Key probe.',
        expectedVersion: 1,
      }, 'not-a-uuid');
      expect(malformedKey.status).toBe(400);
      expect((malformedKey.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

      const badId = await apiJson<ErrorEnvelope>(sessionA.page.request, {
        method: 'GET',
        path: '/api/billing/turnover-reviews/not-a-uuid',
      });
      expect(badId.status).toBe(400);
      expect(badId.json.error.code).toBe('VALIDATION_ERROR');

      const missing = await apiJson<ErrorEnvelope>(sessionA.page.request, {
        method: 'GET',
        path: `/api/billing/turnover-reviews/${randomUUID()}`,
      });
      expect(missing.status).toBe(404);
      expect(missing.json.error.code).toBe('RESOURCE_NOT_FOUND');

      const outsider = await provisionResidentWithRetry(page, browser, {
        runId,
        workerIndex: testInfo.workerIndex,
        stem: 'turnoutsider',
        baseURL,
      });
      try {
        const empty = await listTurnoverReviews(outsider.page.request, {});
        expect(empty.rows).toHaveLength(0);
        expect(empty.unresolvedCount).toBe(0);
        const concealed = await apiJson<ErrorEnvelope>(outsider.page.request, {
          method: 'GET',
          path: `/api/billing/turnover-reviews/${ctx.review207 ?? ''}`,
        });
        expect(concealed.status).toBe(404);
        expect(concealed.json.error.code).toBe('RESOURCE_NOT_FOUND');
        const deniedResolve = await postTurnoverResolve(outsider.page.request, ctx.review207 ?? '', {
          decision: 'NO_CHARGE',
          selectedTenancyIds: [],
          reason: 'Outsider attempt.',
          expectedVersion: 1,
        });
        expect(deniedResolve.status).toBe(404);
        expect((deniedResolve.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');
      } finally {
        await outsider.close();
      }

      const detail = await getTurnoverReview(sessionA.page.request, ctx.review207 ?? '');
      expect(detail.state).toBe('UNRESOLVED');
      expect(detail.version).toBe(1);
    } finally {
      await sessionA.close();
    }
  });

  test('EX2 plus idempotency: no-charge closes the review and replays safely', async ({
    page,
    browser,
  }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const freshA = ctx.freshA;
    expect(freshA).toBeDefined();
    const sessionA = await openOwnerPage(browser, baseURL, freshA?.username ?? '', freshA?.password ?? '');
    try {
      await sessionA.page.goto(`/invoices/turnover-reviews/${ctx.review207 ?? ''}`);
      await expect(sessionA.page.getByTestId('turnover-resolve-form')).toBeVisible();
      await sessionA.page.getByTestId('turnover-resolve-decision-no-charge').click();
      await sessionA.page.getByTestId('turnover-resolve-submit').click();
      await expect(sessionA.page.getByTestId('turnover-resolve-no-charge-reason')).toHaveAttribute('aria-invalid', 'true');
      await expect(sessionA.page.getByTestId('turnover-resolve-no-charge-reason')).toBeFocused();

      const blankReason = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: '   ',
        expectedVersion: 1,
      });
      expect(blankReason.status).toBe(400);
      expect((blankReason.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

      const loadedNoCharge = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [ctx.tenancies207?.[0] ?? ''],
        reason: 'Loaded no-charge must fail.',
        expectedVersion: 1,
      });
      expect(loadedNoCharge.status).toBe(400);
      expect((loadedNoCharge.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

      const key = randomUUID();
      const waived = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: 'Goodwill waiver for June turnover.',
        expectedVersion: 1,
      }, key);
      expect(waived.status).toBe(200);
      const waivedBody = waived.json as ResolveTurnoverEnvelope;
      expect(waivedBody.data.state).toBe('NO_CHARGE');
      expect(waivedBody.data.version).toBe(2);
      expect(waivedBody.data.invoices).toHaveLength(0);

      const replayed = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: 'Goodwill waiver for June turnover.',
        expectedVersion: 1,
      }, key);
      expect(replayed.status).toBe(200);
      expect(replayed.json).toEqual(waived.json);

      const conflicted = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: 'Different body on the same key.',
        expectedVersion: 1,
      }, key);
      expect(conflicted.status).toBe(400);
      expect((conflicted.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

      const probed = await probeTurnover(ctx.review207 ?? '');
      expect(probed.review.state).toBe('NO_CHARGE');
      expect(probed.review.reason).toBe('Goodwill waiver for June turnover.');
      expect(probed.invoices).toHaveLength(0);

      const stale = await postTurnoverResolve(sessionA.page.request, ctx.review207 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: 'Stale second attempt.',
        expectedVersion: 1,
      }, randomUUID());
      expect(stale.status).toBe(409);
      expect((stale.json as ErrorEnvelope).error.code).toBe('VERSION_CONFLICT');

      const queueAfter = await listTurnoverReviews(sessionA.page.request, { state: 'UNRESOLVED' });
      expect(queueAfter.rows.some((row) => row.id === (ctx.review207 ?? ''))).toBe(false);
      expect(queueAfter.unresolvedCount).toBe(0);
      const closedFilter = await listTurnoverReviews(sessionA.page.request, { state: 'NO_CHARGE' });
      expect(closedFilter.rows.some((row) => row.id === (ctx.review207 ?? ''))).toBe(true);

      const rerun = await triggerGenerate(page.request, {
        triggerSource: 'MANUAL',
        fromCycle: '2026-06',
      });
      expect(rerun.json.data.reviewRequired).toBe(0);
      const probedAgain = await probeTurnover(ctx.review207 ?? '');
      expect(probedAgain.review.version).toBe(2);
    } finally {
      await sessionA.close();
    }
  });

  test('admin override: project-managed review resolves with an audited custom amount', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const futureDue = addDaysProjectDate(projectToday(), 30);
    const tenancyId = ctx.tenancies208?.[0] ?? '';
    await page.goto(`/admin/billing/turnover-reviews/${ctx.review208 ?? ''}`);
    await expect(page.getByTestId('turnover-resolve-form')).toBeVisible();
    await page.getByTestId(`turnover-resolve-select-${tenancyId}`).check();
    await page.getByTestId(`turnover-resolve-due-${tenancyId}`).fill(futureDue);
    await page.getByTestId(`turnover-resolve-override-${tenancyId}`).fill('9500.00');
    await page.getByTestId('turnover-resolve-submit').click();
    await expect(page.getByTestId(`turnover-resolve-override-reason-${tenancyId}`)).toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId(`turnover-resolve-override-reason-${tenancyId}`).fill('Goodwill discount for June turnover.');
    await page.getByTestId('turnover-resolve-submit').click();
    await expect(page.getByTestId('turnover-review-detail-state')).toHaveText('Resolved', { timeout: 15000 });
    await expect(page.getByTestId('turnover-resolve-form')).toHaveCount(0);

    const detail = await getTurnoverReview(page.request, ctx.review208 ?? '');
    expect(detail.state).toBe('RESOLVED');
    expect(detail.version).toBe(2);
    expect(detail.invoiceIds).toHaveLength(1);

    const probed = await probeTurnover(ctx.review208 ?? '');
    expect(probed.invoices).toHaveLength(1);
    expect(probed.invoices[0]?.kind).toBe('PROJECT_MANAGED_RENT');
    expect(probed.invoices[0]?.totalAmount).toBe('950000');
    expect(probed.invoices[0]?.reviewerSnapshotSource).toBe('TURNOVER_REVIEW');
    expect(probed.invoices[0]?.payee?.accountNumber).toBe('208-0-00001-9');

    const audit = await probeAudit(probed.invoices[0]?.id ?? '');
    const issuedEntry = audit.entries.find((entry) => entry.resourceType === 'invoice');
    expect(issuedEntry).toBeDefined();
    const issuedAfter = JSON.stringify(issuedEntry?.after ?? {});
    expect(issuedAfter).toContain('Goodwill discount for June turnover.');
    expect(issuedAfter).toContain('800000');
    expect(issuedAfter).toContain('950000');
  });

  test('ui: admin records no-charge live for the february review', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room204 = await findBillingRoom(page, `E2E-${runId}-204`);
    await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: '2026-02',
    });
    const queue = await listTurnoverReviews(page.request, {});
    const review204 = queue.rows.find((row) => row.roomId === room204 && row.calendarMonth === '2026-02-01');
    expect(review204?.state).toBe('UNRESOLVED');
    await page.goto(`/admin/billing/turnover-reviews/${review204?.id ?? ''}`);
    await expect(page.getByTestId('turnover-resolve-form')).toBeVisible();
    await page.getByTestId('turnover-resolve-decision-no-charge').click();
    await page.getByTestId('turnover-resolve-no-charge-reason').fill('February goodwill waiver.');
    await page.getByTestId('turnover-resolve-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('turnover-review-detail-state')).toHaveText('No charge', { timeout: 15000 });
    const detail = await getTurnoverReview(page.request, review204?.id ?? '');
    expect(detail.state).toBe('NO_CHARGE');
    expect(detail.version).toBe(2);
    const probed = await probeTurnover(review204?.id ?? '');
    expect(probed.review.reason).toBe('February goodwill waiver.');
    expect(probed.invoices).toHaveLength(0);
  });

  test('blocked review: zero-snapshot room stays visible to admin but never resolves', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const detail = await getTurnoverReview(page.request, ctx.review209 ?? '');
    expect(detail.state).toBe('UNRESOLVED');
    expect(detail.blocked).toBe(true);
    const failed = await postTurnoverResolve(page.request, ctx.review209 ?? '', {
      decision: 'NO_CHARGE',
      selectedTenancyIds: [],
      reason: 'Blocked attempt must fail.',
      expectedVersion: 1,
    }, randomUUID());
    expect(failed.status).toBe(500);
    expect((failed.json as ErrorEnvelope).error.code).toBe('INTERNAL_ERROR');
    const failedIssue = await postTurnoverResolve(page.request, ctx.review209 ?? '', {
      decision: 'ISSUE_INVOICES',
      selectedTenancyIds: detail.candidateTenancyIds,
      perInvoice: detail.candidateTenancyIds.map((tenancyId) => ({
        tenancyId,
        dueDate: addDaysProjectDate(projectToday(), 30),
      })),
      expectedVersion: 1,
    }, randomUUID());
    expect(failedIssue.status).toBe(500);
    expect((failedIssue.json as ErrorEnvelope).error.code).toBe('INTERNAL_ERROR');
    const again = await getTurnoverReview(page.request, ctx.review209 ?? '');
    expect(again.state).toBe('UNRESOLVED');
    expect(again.version).toBe(1);
    const probed = await probeTurnover(ctx.review209 ?? '');
    expect(probed.invoices).toHaveLength(0);
  });

  test('scope: terminal private work stays concealed from new owners and admins', async ({
    page,
    browser,
  }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const freshB = ctx.freshB;
    expect(freshB).toBeDefined();
    const sessionB = await openOwnerPage(browser, baseURL, freshB?.username ?? '', freshB?.password ?? '');
    try {
      const queueB = await listTurnoverReviews(sessionB.page.request, {});
      expect(queueB.rows).toHaveLength(0);
      expect(queueB.unresolvedCount).toBe(0);
      const terminalB = await listTurnoverReviews(sessionB.page.request, { state: 'RESOLVED' });
      expect(terminalB.rows).toHaveLength(0);
      const concealed = await apiJson<ErrorEnvelope>(sessionB.page.request, {
        method: 'GET',
        path: `/api/billing/turnover-reviews/${ctx.review206 ?? ''}`,
      });
      expect(concealed.status).toBe(404);
      expect(concealed.json.error.code).toBe('RESOURCE_NOT_FOUND');
      const resolveAttempt = await postTurnoverResolve(sessionB.page.request, ctx.review206 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: 'Terminal intruder attempt.',
        expectedVersion: 2,
      });
      expect(resolveAttempt.status).toBe(404);
      expect((resolveAttempt.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

      const concealedAdmin = await apiJson<ErrorEnvelope>(page.request, {
        method: 'GET',
        path: `/api/billing/turnover-reviews/${ctx.review206 ?? ''}`,
      });
      expect(concealedAdmin.status).toBe(404);
      expect(concealedAdmin.json.error.code).toBe('RESOURCE_NOT_FOUND');
    } finally {
      await sessionB.close();
    }
  });

  test('seam: november generation auto-issues without opening a new review for old owners', async ({
    page,
    browser,
  }) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room206 = await findBillingRoom(page, `E2E-${runId}-206`);
    const freshA = ctx.freshA;
    const freshB = ctx.freshB;
    expect(freshA).toBeDefined();
    expect(freshB).toBeDefined();
    const sessionA = await openOwnerPage(browser, baseURL, freshA?.username ?? '', freshA?.password ?? '');
    const sessionB = await openOwnerPage(browser, baseURL, freshB?.username ?? '', freshB?.password ?? '');
    try {
      const november = await triggerGenerate(page.request, {
        triggerSource: 'MANUAL',
        fromCycle: '2026-11',
      });
      expect(november.json.data.caughtUp).toBe(true);
      const queueA = await listTurnoverReviews(sessionA.page.request, {});
      expect(queueA.rows.some((row) => row.roomId === room206 && row.calendarMonth === '2026-11-01')).toBe(false);
      const novemberRowsB = (await listInvoices(sessionB.page.request, { roomId: room206 })).filter(
        (row) => row.periodStart === '2026-11-01' && row.kind === 'PRIVATE_RENT',
      );
      expect(novemberRowsB).toHaveLength(1);
      expect(novemberRowsB[0]?.total.amount).toBe('12000.00');
      const novemberRowsA = (await listInvoices(sessionA.page.request, { roomId: room206 })).filter(
        (row) => row.periodStart === '2026-11-01' && row.kind === 'PRIVATE_RENT',
      );
      expect(novemberRowsA).toHaveLength(0);
      const juneRowsA = (await listInvoices(sessionA.page.request, { roomId: room206 })).filter(
        (row) => row.periodStart === '2026-06-01' && row.kind === 'PRIVATE_RENT',
      );
      expect(juneRowsA).toHaveLength(2);
    } finally {
      await sessionA.close();
      await sessionB.close();
    }
  });

  test('suspended original reviewer is denied while the review stays open', async ({
    page,
    browser,
  }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const freshA = ctx.freshA;
    expect(freshA).toBeDefined();
    const suspended = await apiJson<ErrorEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/users/${freshA?.userId ?? ''}/status`,
      body: { accountStatus: 'SUSPENDED' },
    });
    expect(suspended.status).toBe(200);
    const suspendedContext = await browser.newContext({ baseURL });
    const suspendedPage = await suspendedContext.newPage();
    try {
      const signin = await signInSuspendedActor(suspendedPage.request, {
        username: freshA?.username ?? '',
        password: freshA?.password ?? '',
      });
      expect(signin.status).toBe(200);
      const queue = await apiJson<ErrorEnvelope>(suspendedPage.request, {
        method: 'GET',
        path: '/api/billing/turnover-reviews?pageSize=10',
      });
      expect(queue.status).toBe(403);
      expect(queue.json.error.code).toBe('ACCESS_DENIED');
      const denied = await postTurnoverResolve(suspendedPage.request, ctx.review206 ?? '', {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: 'Suspended attempt.',
        expectedVersion: 2,
      });
      expect(denied.status).toBe(403);
      expect((denied.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');
      const probed = await probeTurnover(ctx.review206 ?? '');
      expect(probed.review.state).toBe('RESOLVED');
    } finally {
      await suspendedContext.close();
    }
  });
});
