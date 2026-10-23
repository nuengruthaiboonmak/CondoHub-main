import { randomUUID } from 'node:crypto';
import { expect as baseExpect, test } from '@playwright/test';
import { loginAsPoolAdmin } from '../../helpers/owner';
import { readRunContext, runUsername } from '../../fixtures/run-context';
import { apiJson } from '../../helpers/api';
import { installOverlayAudit } from '../../helpers/overlayAudit';
import { completeFirstLogin, provisionUser } from '../../helpers/owner';
import { createFacility, bookSlots } from '../booking/bookingFlow';
const expect = baseExpect.configure({ timeout: 30000 });

test('building modal uses full-width fields and consistent cancel actions', async ({
  page,
}, testInfo) => {
  await loginAsPoolAdmin(page, 'workspace');
  await page.goto('/admin/buildings');
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('admin-buildings-create').click();
    const dialog = page.getByTestId('building-create-dialog');
    await expect(dialog).toBeVisible();
    const input = await page.getByTestId('building-create-name').boundingBox();
    const select = await page.getByTestId('building-create-status').boundingBox();
    expect(Math.abs(input!.width - select!.width)).toBeLessThan(2);
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`building-modal-${width}.png`),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('admin-buildings-create')).toBeFocused();
  }
});

test('context menus give every action an icon and keep disabled actions distinct without excess scrollbars', async ({
  page,
}, testInfo) => {
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const building = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/buildings',
    body: { projectId: randomUUID(), name: `E2E-${runId}-Overlay`, status: 'ACTIVE' },
  });
  const floor = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/floors',
    body: { buildingId: building.json.data.id, label: 'Floor with rooms' },
  });
  await apiJson(page.request, {
    method: 'POST',
    path: '/api/admin/rooms',
    body: {
      buildingId: building.json.data.id,
      floorId: floor.json.data.id,
      name: `E2E-${runId}-101`,
      areaSqm: '30',
      status: 'ACTIVE',
    },
  });
  await page.goto(`/admin/buildings/${building.json.data.id}`);
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    for (const menuId of ['building-actions', `floor-actions-${floor.json.data.id}`]) {
      await page.getByTestId(`${menuId}-trigger`).click();
      const menu = page.getByTestId(`${menuId}-dropdown`);
      await expect(menu).toBeVisible();
      for (const action of await menu.locator('button, a[href]').all())
        await expect(action.locator('svg')).toHaveCount(1);
      expect(
        await menu.evaluate(
          (el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth,
        ),
      ).toBe(true);
      if (menuId.startsWith('floor')) {
        await expect(menu.getByRole('button', { name: 'Delete floor', exact: true })).toBeEnabled();
        await page.getByTestId(`${menuId}-trigger`).press('ArrowDown');
        await expect(menu.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(
          menu.getByRole('button', { name: 'Deactivate floor', exact: true }),
        ).toBeFocused();
      }
      await page.screenshot({
        path: testInfo.outputPath(`${menuId}-${width}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
    }
  }
  const current = (await (await page.request.get('/api/auth/get-session')).json()).user as {
    id: string;
    username: string;
  };
  await page.goto(`/admin/users?query=${current.username}`);
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId(`admin-users-actions-${current.id}-trigger`).click();
    const menu = page.getByTestId(`admin-users-actions-${current.id}-dropdown`);
    const disabled = menu.getByRole('button', { name: 'Delete user', exact: true });
    await expect(disabled).toBeDisabled();
    await expect(disabled.locator('svg')).toHaveCount(1);
    expect(await disabled.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(
      await menu.evaluate(
        (el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`disabled-account-menu-${width}.png`),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
  }
});

test('admin dialogs cover property, ownership, facilities, announcements, billing and user accounts', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(480000);
  await loginAsPoolAdmin(page, 'workspace');
  await installOverlayAudit(page, testInfo, 'admin-audit');
  const { runId } = await readRunContext();
  async function create(path: string, body: unknown) {
    const response = await apiJson<{ data: { id: string } }>(page.request, {
      method: 'POST',
      path,
      body,
    });
    expect(response.status).toBe(200);
    return response.json.data.id;
  }
  async function closeDialog(id: string) {
    await page.getByTestId(`${id}-close`).click();
    await expect(page.getByTestId(id)).not.toBeVisible();
  }
  async function check(trigger: string, id: string, menu?: string) {
    if (menu) await page.getByTestId(`${menu}-trigger`).click();
    await page.getByTestId(trigger).click();
    await expect(page.getByTestId(id)).toBeVisible();
    await closeDialog(id);
  }
  const building = await create('/api/admin/buildings', {
    projectId: randomUUID(),
    name: `E2E-${runId}-ModalAudit`,
    status: 'ACTIVE',
  });
  const emptyFloor = await create('/api/admin/floors', {
    buildingId: building,
    label: 'Empty floor',
  });
  const floor = await create('/api/admin/floors', {
    buildingId: building,
    label: 'Residential floor',
  });
  const room = await create('/api/admin/rooms', {
    buildingId: building,
    floorId: floor,
    name: `E2E-${runId}-Payments-Modal`,
    areaSqm: '30',
    status: 'ACTIVE',
  });
  const ownerName = runUsername(runId, `owner`);
  const owner = await provisionUser(page, { username: ownerName, name: 'Modal audit owner' });
  const memberName = runUsername(runId, `member`);
  const member = await provisionUser(page, { username: memberName, name: 'Modal audit member' });
  const memberId = await create(`/api/rooms/${room}/members`, {
    username: memberName,
    memberRole: 'SUB',
  });
  await apiJson(page.request, {
    method: 'POST',
    path: `/api/admin/rooms/${room}/owners`,
    body: { username: ownerName },
  });
  await page.goto(`/admin/buildings/${building}`);
  await check('building-edit-open', 'building-edit-dialog', 'building-actions');
  await check('building-deactivate-open', 'building-status-confirm', 'building-actions');
  await check('floor-create-open', 'floor-create-dialog');
  await check(`floor-edit-open-${floor}`, 'floor-edit-dialog', `floor-actions-${floor}`);
  await check(
    `floor-delete-open-${emptyFloor}`,
    'floor-delete-confirm',
    `floor-actions-${emptyFloor}`,
  );
  await check('room-create-open', 'room-create-dialog');
  await check(`room-edit-open-${room}`, 'room-edit-dialog', `room-actions-${room}`);
  await check(`room-deactivate-open-${room}`, 'room-status-confirm', `room-actions-${room}`);
  await check(`room-owner-assign-open-${room}`, 'room-owner-assign-dialog', `room-actions-${room}`);
  await apiJson(page.request, {
    method: 'PATCH',
    path: `/api/admin/rooms/${room}`,
    body: { status: 'INACTIVE' },
  });
  await page.reload();
  await check(`room-reactivate-open-${room}`, 'room-status-confirm', `room-actions-${room}`);
  await apiJson(page.request, {
    method: 'PATCH',
    path: `/api/admin/rooms/${room}`,
    body: { status: 'ACTIVE' },
  });
  await apiJson(page.request, {
    method: 'PATCH',
    path: `/api/admin/buildings/${building}`,
    body: { status: 'INACTIVE' },
  });
  await page.reload();
  await check('building-reactivate-open', 'building-status-confirm', 'building-actions');
  await apiJson(page.request, {
    method: 'PATCH',
    path: `/api/admin/buildings/${building}`,
    body: { status: 'ACTIVE' },
  });
  await page.goto(`/rooms/${room}`);
  await check('ownership-assign-open', 'ownership-assign-dialog');
  await check('room-member-add-open', 'room-member-add-dialog');
  await check(`room-membership-end-${memberId}`, 'room-membership-end-confirm');
  await page.getByText('More ownership actions', { exact: true }).click();
  for (const action of ['transfer', 'remove', 'correct'])
    await check(`ownership-${action}-open`, `ownership-${action}-dialog`);
  await page.goto('/admin/facilities');
  await check('admin-facilities-create', 'facility-create-dialog');
  const facility = await createFacility(page, {
    code: `E2E-${runId}-MODAL`,
    name: `E2E-${runId}-Modal facility`,
  });
  await page.goto(`/admin/facilities/${facility.id}`);
  await check('facility-edit-open', 'facility-edit-dialog', 'facility-actions');
  await check('facility-delete-open', 'facility-delete-dialog', 'facility-actions');
  await page.getByTestId('config-change-open').click();
  await expect(page.getByTestId('config-change-open-end')).toHaveValue('00:00');
  await page
    .getByTestId('config-change-effective-at')
    .fill(new Date(Date.now() + 172800000).toISOString().slice(0, 16));
  await page.getByTestId('config-change-preview').click();
  await expect(page.getByTestId('config-change-preview-result')).toBeVisible();
  await expect(page.getByTestId('config-change-commit')).toBeEnabled();
  await page.getByTestId('config-change-dialog-close').click();
  await page
    .getByTestId('config-change-dialog-discard')
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await expect(page.getByTestId('config-change-dialog')).not.toBeVisible();
  await check('closure-create-open', 'closure-create-dialog');
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(3, 0, 0, 0);
  const booking = await bookSlots(page, facility.id, {
    roomId: room,
    startsAt: [tomorrow.toISOString()],
  });
  await page.reload();
  await check(
    `admin-facility-cancel-${booking.slots[0]!.id}-open`,
    `admin-facility-cancel-${booking.slots[0]!.id}`,
  );
  await page.goto('/admin/announcements');
  await check('admin-announcements-create', 'announcement-create-dialog');
  const announcement = await create('/api/admin/announcements', {
    title: `E2E-${runId}-Modal announcement`,
    body: 'A community update for the overlay audit.',
    imageIds: [],
  });
  await page.goto(`/admin/announcements/${announcement}`);
  await check('announcement-edit-open', 'announcement-edit-dialog', 'announcement-actions');
  await page.goto('/admin/billing/events');
  await check('charge-event-list-new', 'charge-event-create-dialog');
  await page.goto(`/admin/users?query=${memberName}`);
  await check('admin-users-provision-open', 'admin-users-provision');
  await page.getByTestId(`admin-users-actions-${member.userId}-trigger`).click();
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await closeDialog('admin-users-confirm');
  await page.getByTestId(`admin-users-actions-${member.userId}-trigger`).click();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await closeDialog('admin-users-confirm');
  await apiJson(page.request, {
    method: 'PATCH',
    path: `/api/admin/users/${member.userId}/status`,
    body: { accountStatus: 'SUSPENDED' },
  });
  await page.reload();
  await page.getByTestId(`admin-users-actions-${member.userId}-trigger`).click();
  await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
  await closeDialog('admin-users-confirm');
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('user-menu-change-password').click();
  await closeDialog('account-password-dialog');
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByTestId('app-nav-open').click();
  await closeDialog('app-nav-sheet');
  const ownerContext = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  });
  try {
    const ownerPage = await ownerContext.newPage();
    await installOverlayAudit(ownerPage, testInfo, 'resident-audit');
    await completeFirstLogin(ownerPage, {
      username: ownerName,
      tempPassword: owner.tempPassword,
      newPassword: `Overlay-${runId}-owner-pw1`,
    });
    await ownerPage.goto(`/rooms/${room}`);
    await ownerPage.getByTestId('ownership-assign-open').click();
    await ownerPage.getByTestId('ownership-assign-dialog-close').click();
    await ownerPage.goto(`/rooms/${room}/bookings`);
    await ownerPage.getByTestId(`room-bookings-cancel-${booking.slots[0]!.id}-open`).click();
    await ownerPage.getByTestId(`room-bookings-cancel-${booking.slots[0]!.id}-close`).click();
    await ownerPage.goto('/maintenance');
    await ownerPage.getByTestId('maintenance-new-link').click();
    await ownerPage.getByTestId('maintenance-create-cancel').click();
    await expect(ownerPage.getByTestId('maintenance-create-dialog')).not.toBeVisible();
    await expect(ownerPage).toHaveURL(/\/maintenance$/);
    await ownerPage.setViewportSize({ width: 360, height: 900 });
    await ownerPage.getByTestId('app-nav-open').click();
    await ownerPage.getByTestId('app-nav-sheet').getByTestId('user-menu-trigger').click();
    await ownerPage.getByTestId('app-nav-sheet').getByTestId('user-menu-change-password').click();
    await ownerPage.getByTestId('account-password-cancel').click();
    await expect(ownerPage.getByTestId('app-nav-sheet')).toBeVisible();
    await ownerPage.getByTestId('app-nav-sheet-close').click();
  } finally {
    await ownerContext.close();
  }
});

test('room creation directs users to add a floor before opening the form', async ({
  page,
}, testInfo) => {
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const building = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/buildings',
    body: { projectId: randomUUID(), name: `E2E-${runId}-NoFloors`, status: 'ACTIVE' },
  });
  await page.goto(`/admin/buildings/${building.json.data.id}`);
  await expect(page.getByTestId('room-create-open')).toBeDisabled();
  await expect(
    page.getByText('Create a floor, then add your first room.', { exact: true }),
  ).toBeVisible();
  await installOverlayAudit(page, testInfo, 'empty-building');
  await page.getByTestId('floor-create-open').click();
  await page
    .getByTestId('floor-create-dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.getByTestId('floor-create-open')).toBeFocused();
});
