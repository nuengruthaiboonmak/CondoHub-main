import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsAdmin } from '../../helpers/owner';
import { provisionResidentWithRetry } from '../../helpers/resident';
import {
  findBillingRoom,
  getChargeEvent,
  listInvoices,
  postChargeEvent,
  type ErrorEnvelope,
} from './billingFlow';

const execFileAsync = promisify(execFile);

interface IssueDriverResult {
  eventId: string;
  created: number;
  skipped: number;
  reviewRequired: number;
  cycleErrors: number;
}

async function driveIssuance(eventId: string): Promise<IssueDriverResult> {
  const { stdout } = await execFileAsync('pnpm', ['billing:ops', 'issue-event', '--', '--event', eventId], {
    shell: process.platform === 'win32',
    cwd: path.resolve(__dirname, '..', '..', '..'),
    env: process.env,
  });
  const line = stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('{'));
  if (line === undefined) throw new Error('Issuance driver printed no result.');
  return JSON.parse(line) as IssueDriverResult;
}

test.describe('billing one-time common fee events: issuance, per-room invoices, route negatives', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180000);

  test('posted event issues exactly one invoice per room and flips to ISSUED', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const rooms = [
      await findBillingRoom(page, `E2E-${runId}-201`),
      await findBillingRoom(page, `E2E-${runId}-202`),
      await findBillingRoom(page, `E2E-${runId}-203`),
      await findBillingRoom(page, `E2E-${runId}-204`),
      await findBillingRoom(page, `E2E-${runId}-205`),
      await findBillingRoom(page, `E2E-${runId}-206`),
      await findBillingRoom(page, `E2E-${runId}-207`),
      await findBillingRoom(page, `E2E-${runId}-208`),
      await findBillingRoom(page, `E2E-${runId}-209`),
    ];

    const created = await postChargeEvent(page.request, {
      eventEffectiveDate: '2026-06-15',
      configuredAmount: { amount: '777.00', currency: 'THB' },
      chargeContext: { runId, note: `E2E-${runId} elevator repair sinking fund.` },
      status: 'OPEN',
    });
    expect(created.json.data.status).toBe('OPEN');

    const issued = await driveIssuance(created.json.data.id);
    expect(issued.eventId).toBe(created.json.data.id);
    expect(issued.created).toBeGreaterThanOrEqual(9);

    for (const roomId of rooms) {
      const matches = (await listInvoices(page.request, { roomId })).filter(
        (row) =>
          row.kind === 'COMMON_FEE' &&
          row.periodStart === '2026-06-15' &&
          row.total.amount === '777.00',
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.dueDate).toBe('2026-06-15');
      expect(matches[0]?.tenancyId).toBeNull();
    }

    const fetched = await getChargeEvent(page.request, created.json.data.id);
    expect(fetched.status).toBe('ISSUED');

    const reissued = await driveIssuance(created.json.data.id);
    expect(reissued.created).toBe(0);
    for (const roomId of rooms) {
      const matches = (await listInvoices(page.request, { roomId })).filter(
        (row) =>
          row.kind === 'COMMON_FEE' &&
          row.periodStart === '2026-06-15' &&
          row.total.amount === '777.00',
      );
      expect(matches).toHaveLength(1);
    }
  });

  test('event routes validate strictly and deny non-admin actors', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);

    const missingDate = await apiJson<ErrorEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/billing/common-fee-events',
      body: { configuredAmount: { amount: '100.00', currency: 'THB' } },
    });
    expect(missingDate.status).toBe(400);
    expect(missingDate.json.error.code).toBe('VALIDATION_ERROR');

    const extraKey = await apiJson<ErrorEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/billing/common-fee-events',
      body: { eventEffectiveDate: '2026-06-16', injected: true },
    });
    expect(extraKey.status).toBe(400);
    expect(extraKey.json.error.code).toBe('VALIDATION_ERROR');

    const badAmount = await apiJson<ErrorEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/billing/common-fee-events',
      body: { eventEffectiveDate: '2026-06-16', configuredAmount: { amount: '10', currency: 'THB' } },
    });
    expect(badAmount.status).toBe(400);
    expect(badAmount.json.error.code).toBe('VALIDATION_ERROR');

    const badDate = await apiJson<ErrorEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/billing/common-fee-events',
      body: { eventEffectiveDate: '2026-02-30' },
    });
    expect(badDate.status).toBe(400);
    expect(badDate.json.error.code).toBe('VALIDATION_ERROR');

    const badId = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: '/api/admin/billing/common-fee-events/not-a-uuid',
    });
    expect(badId.status).toBe(400);
    expect(badId.json.error.code).toBe('VALIDATION_ERROR');

    const missing = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: `/api/admin/billing/common-fee-events/${randomUUID()}`,
    });
    expect(missing.status).toBe(404);
    expect(missing.json.error.code).toBe('RESOURCE_NOT_FOUND');

    const outsider = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'billevent',
      baseURL,
    });
    try {
      const deniedPost = await apiJson<ErrorEnvelope>(outsider.page.request, {
        method: 'POST',
        path: '/api/admin/billing/common-fee-events',
        body: { eventEffectiveDate: '2026-06-17' },
      });
      expect(deniedPost.status).toBe(403);
      expect(deniedPost.json.error.code).toBe('ACCESS_DENIED');
      const deniedGet = await apiJson<ErrorEnvelope>(outsider.page.request, {
        method: 'GET',
        path: `/api/admin/billing/common-fee-events/${randomUUID()}`,
      });
      expect(deniedGet.status).toBe(403);
      expect(deniedGet.json.error.code).toBe('ACCESS_DENIED');
    } finally {
      await outsider.close();
    }
  });

  test('ui: creating an event through the form lands on its detail page', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    await page.goto('/admin/billing/events/new');
    await page.getByTestId('charge-event-create-date').fill('2026-06-18');
    await page
      .getByTestId('charge-event-create-amount')
      .fill(`444.${(test.info().workerIndex % 90) + 10}`);
    await page.getByTestId('charge-event-create-note').fill(`UI create probe ${runId}.`);
    await page.getByTestId('charge-event-create-submit').click();
    await expect(page.getByTestId('charge-event-detail-page')).toBeVisible();
    await expect(page.getByTestId('charge-event-detail-status')).toHaveText('OPEN');
    const createdId = (await page.getByTestId('charge-event-detail-id').textContent())?.trim() ?? '';
    expect(createdId).toMatch(/^[0-9a-f-]{36}$/i);
    const fetched = await getChargeEvent(page.request, createdId);
    expect(fetched.eventEffectiveDate).toBe('2026-06-18');
    expect(fetched.chargeContext).toMatchObject({ note: `UI create probe ${runId}.` });
    await page.goto('/admin/billing/events');
    await expect(page.getByTestId(`charge-event-row-${createdId}`)).toBeVisible();
  });

  test('ui: the event form shows validation alerts and stays keyboard reachable', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/billing/events/new');
    await page.getByTestId('charge-event-create-submit').click();
    await expect(page.getByTestId('charge-event-create-form').getByRole('alert').first()).toBeVisible();
    await expect(page.getByTestId('charge-event-create-date')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('charge-event-create-date')).toBeFocused();
    await page.getByTestId('charge-event-create-amount').fill('10');
    await page.getByTestId('charge-event-create-submit').click();
    await expect(page.getByTestId('charge-event-create-amount')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await page.getByTestId('charge-event-create-date').fill('2026-06-19');
    await page.getByTestId('charge-event-create-amount').fill('445.00');
    await page.getByTestId('charge-event-create-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('charge-event-detail-page')).toBeVisible();
    await expect(page.getByTestId('charge-event-detail-status')).toHaveText('OPEN');
  });

  test('ui: the event form accepts an empty optional amount', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    await page.goto('/admin/billing/events/new');
    await page.getByTestId('charge-event-create-date').fill('2026-06-20');
    await page.getByTestId('charge-event-create-note').fill(`No-amount probe ${runId}.`);
    await page.getByTestId('charge-event-create-submit').click();
    await expect(page.getByTestId('charge-event-detail-page')).toBeVisible();
    const createdId = (await page.getByTestId('charge-event-detail-id').textContent())?.trim() ?? '';
    expect(createdId).toMatch(/^[0-9a-f-]{36}$/i);
    const fetched = await getChargeEvent(page.request, createdId);
    expect(fetched.eventEffectiveDate).toBe('2026-06-20');
    expect(fetched.configuredAmount).toBeNull();
  });
});
