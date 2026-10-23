import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { completeFirstLogin, loginAsPoolAdmin, provisionUser } from '../../helpers/owner';
import { readRunContext, runUsername } from '../../fixtures/run-context';
import { apiJson } from '../../helpers/api';
import { installOverlayAudit } from '../../helpers/overlayAudit';

async function create(page: Page, path: string, body: unknown) {
  const result = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path,
    body,
  });
  expect(result.status).toBe(200);
  return result.json.data.id;
}

async function makeRoom(page: Page, runId: string, label: string) {
  const buildingId = await create(page, '/api/admin/buildings', {
    projectId: randomUUID(),
    name: `E2E-${runId}-${label}`,
    status: 'ACTIVE',
  });
  const floorId = await create(page, '/api/admin/floors', { buildingId, label: 'Scheduled floor' });
  const roomId = await create(page, '/api/admin/rooms', {
    buildingId,
    floorId,
    name: `E2E-${runId}-${label}Room`,
    areaSqm: '30',
    status: 'ACTIVE',
  });
  return { roomId, buildingId };
}

test('cancelling a scheduled rental revokes linked access, preserves billing and permits replacement dates', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000);
  await loginAsPoolAdmin(page, 'workspace');
  await installOverlayAudit(page, info, 'scheduled-project');
  const { runId } = await readRunContext();
  const { roomId, buildingId } = await makeRoom(page, runId, 'ScheduledRental');
  const startsAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const tenancyId = await create(page, `/api/rooms/${roomId}/tenancies`, {
    startsAt,
    managementMode: 'PROJECT_MANAGED',
  });
  const username = runUsername(runId, `scheduled`);
  const account = await provisionUser(page, { username, name: `E2E-${runId}-ScheduledTenant` });
  await create(page, `/api/rooms/${roomId}/members`, {
    userId: account.userId,
    memberRole: 'MAIN',
    tenancyId,
  });
  const cycle = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date(startsAt));
  expect(
    (
      await page.request.put(`/api/rooms/${roomId}/rent-settings`, {
        data: {
          tenancyId,
          amount: { amount: '1000.00', currency: 'THB' },
          effectiveMonth: cycle,
          expectedId: null,
        },
      })
    ).status(),
  ).toBe(200);
  const adminId = (await (await page.request.get('/api/auth/get-session')).json()).user
    .id as string;
  execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      '--conditions=react-server',
      'e2e/fixtures/lifecycle-state.ts',
      runId,
      'seed-payee',
      roomId,
      adminId,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf-8' },
  );
  const issuance = await page.request.post(`/api/rooms/${roomId}/rent-invoices`, {
    data: { tenancyId, cycle },
  });
  expect(issuance.status()).toBe(200);
  const invoiceId = (await issuance.json()).data.invoiceId as string;
  expect(invoiceId).toBeTruthy();
  const context = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  });
  try {
    const tenant = await context.newPage();
    await completeFirstLogin(tenant, {
      username,
      tempPassword: account.tempPassword,
      newPassword: `Scheduled-${runId}-tenant-pw1`,
    });
    expect(
      (
        await tenant.request.patch(`/api/rooms/${roomId}/tenancies/${tenancyId}`, {
          data: { action: 'CANCEL' },
        })
      ).status(),
    ).toBe(403);
    await tenant.goto(`/rooms/${roomId}/chat`);
    await expect(tenant.getByTestId('chat-connection')).toHaveText('Connected');
    await page.goto(`/rooms/${roomId}/rental`);
    await page.getByTestId('rental-period-details').locator('summary').click();
    await page.getByTestId(`room-tenancy-cancel-${tenancyId}`).click();
    await page.getByTestId('room-tenancy-cancel-submit').click();
    await expect(page.getByTestId('room-tenancy-cancel-confirm')).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'Selected rental', exact: true })).toContainText(
      'Cancelled',
    );
    await expect(page.getByTestId('rental-tenant-add-open')).toHaveCount(0);
    await expect(tenant).toHaveURL('/rooms', { timeout: 15000 });
    expect((await tenant.request.get(`/api/rooms/${roomId}`)).status()).toBe(404);
    expect(
      (
        await tenant.request.post(`/api/rooms/${roomId}/messages`, {
          data: { clientMessageId: randomUUID(), text: 'No access after cancellation.' },
        })
      ).status(),
    ).toBe(404);
    const detail = (await (await page.request.get(`/api/rooms/${roomId}`)).json()).data;
    const cancelled = detail.tenancies.find((row: { id: string }) => row.id === tenancyId) as {
      state: string;
      startsAt: string;
      endsAt: string | null;
    };
    expect(cancelled).toMatchObject({ state: 'CANCELLED', startsAt, endsAt: null });
    expect(detail.memberships).toHaveLength(1);
    expect((await tenant.request.get(`/api/invoices/${invoiceId}`)).status()).toBe(200);
    await tenant.goto(`/invoices/${invoiceId}`);
    await expect(tenant.getByTestId('invoice-detail-tenancy')).toContainText('cancelled');
    expect(
      (
        await page.request.post(`/api/rooms/${roomId}/rent-invoices`, {
          data: { tenancyId, cycle },
        })
      ).status(),
    ).toBe(404);
    const replacement = await create(page, `/api/rooms/${roomId}/tenancies`, {
      startsAt,
      managementMode: 'PROJECT_MANAGED',
    });
    expect(
      (
        await page.request.patch(`/api/rooms/${roomId}/tenancies/${replacement}`, {
          data: { action: 'CANCEL' },
        })
      ).status(),
    ).toBe(200);
    expect((await page.request.delete(`/api/admin/buildings/${buildingId}`)).status()).toBe(200);
    expect((await page.request.get(`/api/invoices/${invoiceId}`)).status()).toBe(200);
  } finally {
    await context.close();
  }
});

test('owners can cancel their private scheduled rental and must end a rental that already started', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const { roomId, buildingId } = await makeRoom(page, runId, 'PrivateScheduled');
  const username = runUsername(runId, `scheduledowner`);
  const account = await provisionUser(page, { username, name: `E2E-${runId}-ScheduledOwner` });
  await create(page, `/api/admin/rooms/${roomId}/owners`, { username });
  const context = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  });
  try {
    const owner = await context.newPage();
    await completeFirstLogin(owner, {
      username,
      tempPassword: account.tempPassword,
      newPassword: `Scheduled-${runId}-owner-pw1`,
    });
    await installOverlayAudit(owner, info, 'scheduled-private');
    const startsAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const tenancyId = await create(owner, `/api/rooms/${roomId}/tenancies`, {
      startsAt,
      managementMode: 'PRIVATE_OWNER_MANAGED',
    });
    await owner.goto(`/rooms/${roomId}/rental`);
    await owner.getByTestId('rental-period-details').locator('summary').click();
    await owner.getByTestId(`room-tenancy-cancel-${tenancyId}`).click();
    await owner.getByTestId('room-tenancy-cancel-submit').click();
    await expect(owner.getByRole('region', { name: 'Selected rental', exact: true })).toContainText(
      'Cancelled',
    );
    const started = await create(owner, `/api/rooms/${roomId}/tenancies`, {
      startsAt: new Date(Date.now() - 86400000).toISOString(),
      managementMode: 'PRIVATE_OWNER_MANAGED',
    });
    expect(
      (
        await owner.request.patch(`/api/rooms/${roomId}/tenancies/${started}`, {
          data: { action: 'CANCEL' },
        })
      ).status(),
    ).toBe(400);
    await owner.goto(`/rooms/${roomId}/rental?tenancyId=${started}`);
    await owner
      .getByTestId('rental-period-details')
      .getByText('End rental / move out', { exact: true })
      .click();
    await owner.getByTestId(`room-tenancy-end-${started}`).click();
    await owner.getByTestId('room-tenancy-end-submit').click();
    await expect(owner.getByRole('region', { name: 'Selected rental', exact: true })).toContainText(
      'Ended',
    );
    expect((await page.request.delete(`/api/admin/buildings/${buildingId}`)).status()).toBe(200);
  } finally {
    await context.close();
  }
});
