import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  completeFirstLogin,
  loginAsPoolAdmin,
  loginAsUser,
  provisionUser,
} from '../../helpers/owner';
import { readRunContext, runUsername } from '../../fixtures/run-context';
import { apiJson } from '../../helpers/api';
import { installOverlayAudit } from '../../helpers/overlayAudit';
import { createFacility } from '../booking/bookingFlow';

test.describe.configure({ mode: 'serial' });

test('property lifecycle supports floor status, safe room deletion and cascading deletion after move-out', async ({
  page,
}, info) => {
  test.setTimeout(240000);
  await loginAsPoolAdmin(page, 'workspace');
  await installOverlayAudit(page, info, 'property-lifecycle');
  const { runId } = await readRunContext();
  async function create(endpoint: string, body: unknown) {
    const response = await apiJson<{ data: { id: string } }>(page.request, {
      method: 'POST',
      path: endpoint,
      body,
    });
    expect(response.status).toBe(200);
    return response.json.data.id;
  }
  const buildingId = await create('/api/admin/buildings', {
    projectId: randomUUID(),
    name: `E2E-${runId}-Lifecycle`,
    status: 'ACTIVE',
  });
  const floorId = await create('/api/admin/floors', { buildingId, label: 'Lifecycle floor' });
  const otherFloorId = await create('/api/admin/floors', { buildingId, label: 'Other floor' });
  const makeRoom = (floor: string, label: string) =>
    create('/api/admin/rooms', {
      buildingId,
      floorId: floor,
      name: `E2E-${runId}-${label}`,
      areaSqm: '30',
      status: 'ACTIVE',
    });
  const emptyId = await makeRoom(floorId, 'EmptyRoom');
  const occupiedId = await makeRoom(floorId, 'OccupiedRoom');
  const floorChildId = await makeRoom(floorId, 'FloorChild');
  const otherId = await makeRoom(otherFloorId, 'BuildingChild');
  const account = await provisionUser(page, {
    username: runUsername(runId, `lease`),
    name: `E2E-${runId}-LeaseTenant`,
  });
  const tenancyId = await create(`/api/rooms/${occupiedId}/tenancies`, {
    startsAt: new Date(Date.now() - 86400000).toISOString(),
    managementMode: 'PROJECT_MANAGED',
  });
  await create(`/api/rooms/${occupiedId}/members`, {
    userId: account.userId,
    memberRole: 'MAIN',
    tenancyId,
  });
  const cycle = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const settings = await page.request.put(`/api/rooms/${occupiedId}/rent-settings`, {
    data: {
      tenancyId,
      amount: { amount: '1000.00', currency: 'THB' },
      effectiveMonth: cycle,
      expectedId: null,
    },
  });
  expect(settings.status()).toBe(200);
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
      occupiedId,
      adminId,
    ],
    { cwd: path.resolve(process.cwd()), env: process.env, encoding: 'utf-8' },
  );
  const issuance = await page.request.post(`/api/rooms/${occupiedId}/rent-invoices`, {
    data: { tenancyId, cycle },
  });
  expect(issuance.status()).toBe(200);
  const invoiceId = (await issuance.json()).data.invoiceId as string;
  expect(invoiceId).toBeTruthy();
  await page.goto(`/admin/buildings/${buildingId}`);
  await page.getByTestId('building-actions-trigger').click();
  await page.getByTestId('building-delete-open').click();
  await page.getByTestId('building-delete-submit').click();
  await expect(page.getByTestId('building-delete-error')).toContainText(
    `E2E-${runId}-OccupiedRoom`,
  );
  await page.getByTestId('building-delete-dialog-close').click();
  await page.getByTestId(`floor-actions-${floorId}-trigger`).click();
  await page.getByTestId(`floor-status-${floorId}-open`).click();
  await page.getByTestId(`floor-status-${floorId}-submit`).click();
  await expect(page.getByTestId(`floor-status-${floorId}-dialog`)).not.toBeVisible();
  const blocked = await apiJson(page.request, {
    method: 'POST',
    path: `/api/rooms/${emptyId}/tenancies`,
    body: { startsAt: new Date().toISOString(), managementMode: 'PROJECT_MANAGED' },
  });
  expect(blocked.status).toBe(400);
  await page.getByTestId(`floor-actions-${floorId}-trigger`).click();
  await page.getByTestId(`floor-status-${floorId}-open`).click();
  await page.getByTestId(`floor-status-${floorId}-submit`).click();
  await expect(page.getByTestId(`floor-status-${floorId}-dialog`)).not.toBeVisible();
  await page.goto(`/rooms/${emptyId}`);
  for (const action of ['deactivate', 'reactivate'] as const) {
    await page.getByTestId('room-actions-trigger').click();
    await page.getByTestId(`room-${action}-open-${emptyId}`).click();
    await page.getByTestId(`room-${action}-submit`).click();
    await expect(page.getByTestId('room-status-confirm')).not.toBeVisible();
    await expect
      .poll(
        async () => (await (await page.request.get(`/api/rooms/${emptyId}`)).json()).data.status,
      )
      .toBe(action === 'deactivate' ? 'INACTIVE' : 'ACTIVE');
  }
  await page.getByTestId('room-actions-trigger').click();
  await page.getByTestId(`room-delete-open-${emptyId}`).click();
  await page.getByTestId('room-delete-submit').click();
  await expect(page).toHaveURL('/rooms');
  expect((await page.request.get(`/api/rooms/${emptyId}`)).status()).toBe(404);
  expect(
    (
      await page.request.patch(`/api/admin/rooms/${emptyId}`, { data: { status: 'ACTIVE' } })
    ).status(),
  ).toBe(404);
  await page.goto(`/rooms/${occupiedId}/rental`);
  await page
    .getByTestId('rental-period-details')
    .getByText('End rental / move out', { exact: true })
    .click();
  await page.getByTestId(`room-tenancy-end-${tenancyId}`).click();
  await page.getByTestId('room-tenancy-end-submit').click();
  await expect(page.getByTestId('room-tenancy-end-confirm')).not.toBeVisible();
  await page.goto(`/admin/buildings/${buildingId}`);
  await page.getByTestId(`floor-actions-${floorId}-trigger`).click();
  await page.getByTestId(`floor-delete-open-${floorId}`).click();
  await page.getByTestId('floor-delete-submit').click();
  await expect(page.getByTestId('floor-delete-confirm')).not.toBeVisible();
  for (const id of [occupiedId, floorChildId])
    expect((await page.request.get(`/api/rooms/${id}`)).status()).toBe(404);
  await page.getByTestId('building-actions-trigger').click();
  await page.getByTestId('building-delete-open').click();
  await page.getByTestId('building-delete-submit').click();
  await expect(page).toHaveURL('/admin/buildings');
  expect((await page.request.get(`/api/rooms/${otherId}`)).status()).toBe(404);
  await page.goto(`/admin/buildings/${buildingId}`);
  await expect(page).toHaveURL('/admin/buildings');
  await page.goto(`/rooms/${occupiedId}`);
  await expect(page).toHaveURL('/rooms');
  const retained = await page.request.get(`/api/invoices/${invoiceId}`);
  expect(retained.status()).toBe(200);
  expect((await retained.json()).data.roomId).toBe(occupiedId);
  await page.goto(`/admin/billing/invoices/${invoiceId}`);
  await expect(page.getByTestId('invoice-detail-total')).toContainText('1000.00');
  await expect(page.getByTestId('invoice-detail-tenancy')).toBeVisible();
  for (const route of [
    '/api/admin/rooms/not-a-room',
    '/api/admin/floors/not-a-floor',
    '/api/admin/buildings/not-a-building',
    '/api/admin/announcements/not-an-announcement',
  ]) {
    expect((await page.request.delete(route)).status()).toBe(400);
  }
});

test('account deactivation and deletion revoke access and protect the current administrator', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  await loginAsPoolAdmin(page, 'workspace');
  await installOverlayAudit(page, info, 'account-lifecycle');
  const { runId } = await readRunContext();
  const username = runUsername(runId, `lifecycle`);
  const account = await provisionUser(page, { username, name: `E2E-${runId}-LifecycleUser` });
  const context = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  });
  try {
    const user = await context.newPage();
    const password = `Lifecycle-${runId}-pw1`;
    await completeFirstLogin(user, {
      username,
      tempPassword: account.tempPassword,
      newPassword: password,
    });
    expect((await user.request.delete(`/api/admin/users/${account.userId}`)).status()).toBe(403);
    const self = (await (await page.request.get('/api/auth/get-session')).json()).user.id as string;
    expect((await page.request.delete(`/api/admin/users/${self}`)).status()).toBe(403);
    await page.goto(`/admin/users?query=${username}`);
    const menu = page.getByTestId(`admin-users-actions-${account.userId}-trigger`);
    await menu.click();
    await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await page.getByTestId('admin-users-suspend-confirm').click();
    await expect.poll(async () => (await user.request.get('/api/rooms')).status()).toBe(401);
    await user.goto('/login');
    await user.getByTestId('login-username').fill(username);
    await user.getByTestId('login-password').fill(password);
    await user.getByTestId('login-submit').click();
    await expect(user.getByTestId('login-error')).toContainText('This account is inactive.');
    await expect(page.getByTestId('admin-users-table')).toContainText('Inactive');
    await menu.click();
    await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await page.getByTestId('admin-users-reactivate-confirm').click();
    await expect(page.getByTestId('admin-users-table')).toContainText('Active');
    await loginAsUser(user, username, password);
    expect((await user.request.get('/api/rooms')).status()).toBe(200);
    await menu.click();
    await page.getByTestId(`admin-users-delete-${account.userId}-open`).click();
    await page.getByTestId('admin-users-delete-submit').click();
    await expect(menu).not.toBeVisible();
    expect((await user.request.get('/api/rooms')).status()).toBe(401);
    await user.goto('/login');
    await user.getByTestId('login-username').fill(username);
    await user.getByTestId('login-password').fill(password);
    await user.getByTestId('login-submit').click();
    await expect(user.getByTestId('login-error')).toContainText('Invalid username or password.');
    expect(
      (
        await page.request.patch(`/api/admin/users/${account.userId}/status`, {
          data: { accountStatus: 'ACTIVE' },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await page.request.post(`/api/admin/users/${account.userId}/reset-password`)).status(),
    ).toBe(404);
  } finally {
    await context.close();
  }
});

test('facilities expose status actions and announcements can be deleted while retaining records', async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await loginAsPoolAdmin(page, 'workspace');
  await installOverlayAudit(page, info, 'community-lifecycle');
  const { runId } = await readRunContext();
  const facility = await createFacility(page, {
    code: `E2E-${runId}-LifecycleFacility`,
    name: `E2E-${runId}-LifecycleFacility`,
  });
  await page.goto(`/admin/facilities/${facility.id}`);
  for (const expected of ['Inactive', 'Active']) {
    await page.getByTestId('facility-actions-trigger').click();
    await page.getByTestId('facility-status-open').click();
    await page.getByTestId('facility-status-submit').click();
    await expect(page.getByTestId('facility-status-dialog')).not.toBeVisible();
    await expect(page.getByTestId('admin-facility-detail-page')).toContainText(expected);
  }
  await page.getByTestId('facility-actions-trigger').click();
  await page.getByTestId('facility-delete-open').click();
  await page.getByTestId('facility-delete-submit').click();
  await expect(page).toHaveURL('/admin/facilities');
  const announcement = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/announcements',
    body: {
      title: `E2E-${runId}-LifecycleAnnouncement`,
      body: 'A removable community announcement.',
      publishAt: new Date().toISOString(),
    },
  });
  expect(announcement.status).toBe(200);
  await page.goto(`/admin/announcements/${announcement.json.data.id}`);
  for (const status of ['HIDDEN', 'PUBLISHED']) {
    await page.getByTestId('announcement-actions-trigger').click();
    await page.getByTestId('announcement-status-open').click();
    await page.getByTestId('announcement-status-submit').click();
    await expect(page.getByTestId('announcement-status-dialog')).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'Publishing', exact: true })).toContainText(
      status,
    );
  }
  await page.getByTestId('announcement-actions-trigger').click();
  await page.getByTestId('announcement-delete-open').click();
  await page.getByTestId('announcement-delete-submit').click();
  await expect(page).toHaveURL('/admin/announcements');
  expect(
    (await page.request.get(`/api/admin/announcements/${announcement.json.data.id}`)).status(),
  ).toBe(404);
  const output = execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      '--conditions=react-server',
      'e2e/fixtures/lifecycle-state.ts',
      runId,
    ],
    { cwd: path.resolve(process.cwd()), env: process.env, encoding: 'utf-8' },
  );
  expect(JSON.parse(output)).toEqual({
    buildings: 1,
    floors: 2,
    rooms: 4,
    rentals: 1,
    memberships: 1,
    invoices: 1,
    users: 1,
    sessions: 0,
    announcements: 1,
  });
});
