import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext, runUsername } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsPoolAdmin, provisionUser } from '../../helpers/owner';

interface ReviewPage {
  data: Array<{ id: string; blocked: boolean }>;
  meta: { total: number; unresolvedCount: number };
}
interface Fixture {
  publicIds: string[];
  privateReviewId: string;
  projectReviewId: string;
  privateGrantedId: string;
  blockedId: string;
  privateTenancies: string[];
  jobId: string;
}

test('billing keeps scoped pagination, review history and invoice navigation usable', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000);
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const before = await apiJson<ReviewPage>(page.request, {
    method: 'GET',
    path: '/api/billing/turnover-reviews?pageSize=20',
  });
  expect(before.status).toBe(200);
  async function create(path: string, body: unknown) {
    const response = await apiJson<{ data: { id: string } }>(page.request, {
      method: 'POST',
      path,
      body,
    });
    expect(response.status).toBe(200);
    return response.json.data.id;
  }
  const prefix = `E2E-${runId}-BillingAudit`;
  const buildingId = await create('/api/admin/buildings', {
    projectId: randomUUID(),
    name: `${prefix} Building`,
    status: 'ACTIVE',
  });
  const floorId = await create('/api/admin/floors', { buildingId, label: 'Billing floor' });
  const privateRoom = await create('/api/admin/rooms', {
    buildingId,
    floorId,
    name: `${prefix} Private room with a long display name to test small screens`,
    areaSqm: '30',
    status: 'ACTIVE',
  });
  const projectRoom = await create('/api/admin/rooms', {
    buildingId,
    floorId,
    name: `${prefix} Project room`,
    areaSqm: '30',
    status: 'ACTIVE',
  });
  const username = runUsername(runId, `billowner`);
  const owner = await provisionUser(page, { username, name: `${prefix} Owner` });
  for (const roomId of [privateRoom, projectRoom])
    await create(`/api/admin/rooms/${roomId}/owners`, { username });
  const session = await page.request.get('/api/auth/get-session');
  const adminId = (await session.json()).user.id as string;
  async function fixture(action?: string) {
    return promisify(execFile)(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        '--conditions=react-server',
        'e2e/fixtures/billing-workspace.ts',
        privateRoom,
        projectRoom,
        adminId,
        runId,
        ...(action ? [action] : []),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, SEED_ENABLED: 'true', NODE_ENV: 'development' },
      },
    );
  }
  const ownerContext = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  });
  try {
    const { stdout } = await fixture();
    const data = JSON.parse(stdout.trim()) as Fixture;
    const listed = await apiJson<ReviewPage>(page.request, {
      method: 'GET',
      path: '/api/billing/turnover-reviews?pageSize=20',
    });
    expect(listed.status).toBe(200);
    expect(listed.json.meta.unresolvedCount).toBe(
      before.json.meta.unresolvedCount + data.publicIds.length,
    );
    const next = await apiJson<ReviewPage>(page.request, {
      method: 'GET',
      path: '/api/billing/turnover-reviews?page=2&pageSize=20',
    });
    expect(next.status).toBe(200);
    expect(next.json.meta.total).toBe(listed.json.meta.total);
    const ids = [...listed.json.data, ...next.json.data].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of data.publicIds) expect(ids).toContain(id);
    expect(ids).not.toContain(data.privateReviewId);
    const ownerPage = await ownerContext.newPage();
    await completeFirstLogin(ownerPage, {
      username,
      tempPassword: owner.tempPassword,
      newPassword: `Billing-${runId}-owner-pw1`,
    });
    const ownerReviews = await apiJson<ReviewPage>(ownerPage.request, {
      method: 'GET',
      path: '/api/billing/turnover-reviews?pageSize=20',
    });
    expect(ownerReviews.status).toBe(200);
    expect(ownerReviews.json.data.map((row) => row.id).sort()).toEqual(
      [data.privateReviewId, data.privateGrantedId].sort(),
    );
    expect(ownerReviews.json.meta.unresolvedCount).toBe(2);
    await page.goto('/admin/billing/turnover-reviews?state=UNRESOLVED');
    await page.getByTestId('turnover-review-list-next').click();
    await expect(page).toHaveURL(/page=2.*state=UNRESOLVED/);
    await expect(page.getByTestId('turnover-review-list-empty')).toHaveCount(0);
    await page.goto(`/admin/billing/turnover-reviews/${data.blockedId}`);
    await expect(page.getByTestId('turnover-review-detail-blocked-note')).toBeVisible();
    await expect(page.getByTestId('turnover-resolve-form')).toHaveCount(0);
    await page.goto(`/admin/billing/turnover-reviews/${data.projectReviewId}`);
    await page.getByTestId('turnover-resolve-decision-no-charge').check();
    await page
      .getByTestId('turnover-resolve-no-charge-reason')
      .fill('The project waived rent for this turnover month.');
    await page.getByTestId('turnover-resolve-submit').click();
    await expect(page.getByTestId('turnover-review-detail-state')).toHaveText('No charge');
    await ownerPage.goto('/invoices');
    await ownerPage.getByTestId('invoice-turnover-reviews').click();
    await ownerPage.getByTestId(`owner-turnover-review-row-${data.privateReviewId}`).click();
    for (const id of data.privateTenancies) {
      await ownerPage.getByTestId(`turnover-resolve-select-${id}`).check();
      await ownerPage.getByTestId(`turnover-resolve-due-${id}`).fill('2099-01-01');
    }
    await ownerPage.getByTestId('turnover-resolve-submit').click();
    await expect(ownerPage.getByTestId('turnover-review-detail-state')).toHaveText('Resolved');
    await ownerPage.getByTestId('turnover-review-invoice-link-0').click();
    await expect(ownerPage.getByTestId('invoice-detail-page')).toBeVisible();
    await ownerPage.getByTestId('invoice-detail-back').click();
    await expect(ownerPage.getByTestId('invoice-view-receivable')).toHaveAttribute(
      'aria-current',
      'page',
    );
    const noCharge = await apiJson(ownerPage.request, {
      method: 'POST',
      path: `/api/billing/turnover-reviews/${data.privateGrantedId}/resolve`,
      body: {
        decision: 'NO_CHARGE',
        selectedTenancyIds: [],
        reason: 'No charge in this fixture period.',
        expectedVersion: 1,
      },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(noCharge.status).toBe(200);
    async function capture(target: Page, path: string, name: string) {
      await target.goto(path);
      for (const width of [360, 768, 1366]) {
        await target.setViewportSize({ width, height: 900 });
        await expect(target.getByRole('heading', { level: 1 }).first()).toBeVisible();
        expect(
          await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBe(true);
        await target.screenshot({
          path: info.outputPath(`${name}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await capture(ownerPage, '/', 'owner-home');
    await expect(ownerPage.getByTestId('home-rent-collection')).toContainText(
      '1000.00 THB outstanding',
    );
    await expect(ownerPage.getByTestId('home-rent-collection')).toContainText(
      '2025-12-01 to 2025-12-15',
    );
    await expect(ownerPage.getByTestId('home-rent-collection')).toContainText(
      '2025-12-15 to 2026-01-01',
    );
    await capture(ownerPage, '/invoices?view=receivable', 'owner-income');
    await ownerPage.getByTestId('invoice-turnover-reviews').click();
    await expect(ownerPage.getByTestId('owner-turnover-review-unresolved-indicator')).toContainText(
      '0 unresolved',
    );
    await capture(
      ownerPage,
      `/invoices/turnover-reviews/${data.privateReviewId}`,
      'owner-resolved-review',
    );
    await capture(
      page,
      `/admin/billing/turnover-reviews/${data.projectReviewId}`,
      'admin-no-charge-review',
    );
    await capture(page, `/admin/billing/job-runs/${data.jobId}`, 'admin-job-detail');
    await expect(page.getByTestId('job-run-detail-created')).toHaveText('0');
    await expect(page.getByTestId('job-run-detail-review')).toHaveText('0');
  } finally {
    await ownerContext.close();
    await fixture('cleanup');
  }
});
