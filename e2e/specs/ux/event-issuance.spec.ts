import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';
import { installOverlayAudit } from '../../helpers/overlayAudit';

test('one-time events issue selected rooms through UI, retain partial failures and link their invoice history', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await loginAsPoolAdmin(page, 'workspace');
  await installOverlayAudit(page, info, 'event-issuance');
  const { runId } = await readRunContext();
  const prefix = `E2E-${runId}-ManualIssue`;
  async function create(path: string, body: unknown) {
    const result = await apiJson<{ data: { id: string } }>(page.request, {
      method: 'POST',
      path,
      body,
    });
    expect(result.status).toBe(200);
    return result.json.data.id;
  }
  const buildingId = await create('/api/admin/buildings', {
    projectId: randomUUID(),
    name: prefix,
    status: 'ACTIVE',
  });
  const floorId = await create('/api/admin/floors', { buildingId, label: 'Issue floor' });
  const rooms = [];
  for (const index of [1, 2])
    rooms.push(
      await create('/api/admin/rooms', {
        buildingId,
        floorId,
        name: `${prefix}-${index}`,
        areaSqm: '30',
        status: 'ACTIVE',
      }),
    );
  const username = (await (await page.request.get('/api/auth/get-session')).json()).user
    .username as string;
  await create(`/api/admin/rooms/${rooms[0]}/owners`, { username });
  await page.goto('/admin/billing/events');
  await page.getByTestId('charge-event-list-new').click();
  const effectiveDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 86400000));
  await page.getByTestId('charge-event-create-date').fill(effectiveDate);
  await page.getByTestId('charge-event-create-amount').fill('25.00');
  await page.getByTestId('charge-event-create-note').fill(prefix);
  await page.getByTestId('charge-event-create-submit').click();
  await expect(page.getByTestId('charge-event-detail-page')).toBeVisible();
  const eventId = page.url().split('/').at(-1)!;
  await page.getByTestId('charge-event-issue-open').click();
  await page.getByTestId('charge-event-issue-scope').selectOption('SELECTED');
  await page.getByTestId('charge-event-issue-search').fill(prefix);
  for (const id of rooms) await page.getByTestId(`charge-event-issue-room-${id}`).check();
  await page.getByTestId('charge-event-issue-submit').click();
  await expect(page.getByTestId('charge-event-issue-result')).toContainText('1 invoice created');
  await expect(page.getByTestId('charge-event-issue-errors')).toContainText(`${prefix}-2`);
  await expect(page.getByTestId('charge-event-detail-status')).toHaveText('OPEN');
  await page.getByTestId(`charge-event-issue-error-room-${rooms[1]}`).click();
  await page.getByTestId('ownership-assign-open').click();
  await page.getByTestId('ownership-assign-username').fill(username);
  await page.getByTestId('ownership-assign-submit').click();
  await expect(page.getByTestId('ownership-assign-dialog')).not.toBeVisible();
  await page.goto(`/admin/billing/events/${eventId}`);
  await page.getByTestId('charge-event-issue-open').click();
  await expect(page.getByTestId('charge-event-issue-scope')).toHaveCount(0);
  await page.getByTestId('charge-event-issue-submit').click();
  await expect(page.getByTestId('charge-event-detail-status')).toHaveText('ISSUED');
  await page.getByTestId('charge-event-detail-invoices').click();
  await expect(page).toHaveURL(new RegExp(`eventId=${eventId}`));
  const invoices = await page.request.get(`/api/invoices?oneTimeChargeEventId=${eventId}`);
  expect(invoices.status()).toBe(200);
  expect((await invoices.json()).data).toHaveLength(2);
  expect(
    (
      await page.request.post(`/api/admin/billing/common-fee-events/${eventId}/issue`, { data: {} })
    ).status(),
  ).toBe(200);
  await page.goto('/admin/billing/events?status=ISSUED');
  await expect(page.getByTestId(`charge-event-row-${eventId}`)).toContainText(prefix);
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`event-issued-history-${width}.png`),
      fullPage: true,
    });
  }
});

test('an open billing event can be cancelled through its action menu without generating invoices', async ({
  page,
}, info) => {
  await loginAsPoolAdmin(page, 'workspace');
  await installOverlayAudit(page, info, 'event-cancellation');
  const { runId } = await readRunContext();
  const response = await page.request.post('/api/admin/billing/common-fee-events', {
    data: {
      eventEffectiveDate: '2099-01-01',
      configuredAmount: { amount: '25.00', currency: 'THB' },
      chargeContext: { note: `E2E-${runId}-CancelledEvent` },
    },
  });
  expect(response.status()).toBe(200);
  const id = (await response.json()).data.id as string;
  await page.goto(`/admin/billing/events/${id}`);
  await page.getByTestId('charge-event-actions-trigger').click();
  await page.getByTestId('charge-event-cancel-open').click();
  await page.getByTestId('charge-event-cancel-submit').click();
  await expect(page.getByTestId('charge-event-detail-status')).toHaveText('CANCELLED');
  expect(
    (
      await page.request.post(`/api/admin/billing/common-fee-events/${id}/issue`, { data: {} })
    ).status(),
  ).toBe(400);
  const invoices = await page.request.get(`/api/invoices?oneTimeChargeEventId=${id}`);
  expect((await invoices.json()).data).toHaveLength(0);
  await page.goto('/admin/billing/events?status=CANCELLED');
  await expect(page.getByTestId(`charge-event-row-${id}`)).toContainText(
    `E2E-${runId}-CancelledEvent`,
  );
});
