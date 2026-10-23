import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { loginAsPoolAdmin, completeFirstLogin } from '../../helpers/owner';
import { readRunContext, runUsername } from '../../fixtures/run-context';
import { buildValidImage } from '../../helpers/announcementFiles';
import type { BookingEnvelope } from '../booking/bookingFlow';

async function provisionThroughUi(page: Page, username: string, name: string) {
  await page.goto('/admin/users');
  await page.getByTestId('admin-users-provision-open').click();
  await page.getByTestId('admin-users-provision-username').fill(username);
  await page.getByTestId('admin-users-provision-email').fill(`${username}@example.test`);
  await page.getByTestId('admin-users-provision-name').fill(name);
  const answer = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/users') && response.request().method() === 'POST',
  );
  await page.getByTestId('admin-users-provision-submit').click();
  const response = await answer;
  expect(response.status()).toBe(200);
  const data = (await response.json()).data as { userId: string; tempPassword: string };
  await page
    .getByTestId('admin-users-temp-password')
    .getByRole('button', { name: 'Dismiss', exact: true })
    .click();
  return data;
}

test('announcement publishing validates schedules and supports draft, publish, edit, hide and restore through UI', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const title = `E2E-${runId} Community update`;
  await page.goto('/admin/announcements');
  await page.getByRole('button', { name: 'New announcement', exact: true }).click();
  await page.getByTestId('announcement-create-title').fill(title);
  await page
    .getByTestId('announcement-create-body')
    .fill('A community update with a retained publication date.');
  await page.getByTestId('announcement-create-mode-scheduled').check();
  await page.getByTestId('announcement-create-submit').click();
  await expect(page.getByTestId('announcement-create-publish-at')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByTestId('announcement-create-publish-at')).toBeFocused();
  await page.getByTestId('announcement-create-mode-draft').check();
  const photo = await buildValidImage('png', 32);
  await page
    .getByTestId('announcement-create-upload-input')
    .setInputFiles({ name: 'community.png', mimeType: 'image/png', buffer: photo.bytes });
  await expect(page.getByTestId('announcement-create-image-list')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('announcement-create-submit').click();
  await expect(page).toHaveURL(/\/admin\/announcements\/[0-9a-f-]+$/);
  const id = page.url().split('/').at(-1)!;
  await expect(page.getByRole('region', { name: 'Publishing', exact: true })).toContainText(
    'DRAFT',
  );
  const username = runUsername(runId, `reader`);
  const account = await provisionThroughUi(page, username, `E2E-${runId} Reader`);
  const context = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  });
  try {
    const reader = await context.newPage();
    await completeFirstLogin(reader, {
      username,
      tempPassword: account.tempPassword,
      newPassword: `Community-${runId}-reader-pw1`,
    });
    expect((await reader.request.get(`/api/announcements/${id}`)).status()).toBe(404);
    await page.goto(`/admin/announcements/${id}`);
    async function edit() {
      await page.getByTestId('announcement-actions-trigger').click();
      await page.getByTestId('announcement-edit-open').click();
    }
    await edit();
    await expect(page.getByTestId('announcement-edit-visible')).toHaveText('Draft');
    await page.getByTestId('announcement-edit-mode-scheduled').check();
    await page
      .getByTestId('announcement-edit-publish-at')
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await page.getByTestId('announcement-edit-submit').click();
    await expect(page.getByTestId('announcement-edit-dialog')).not.toBeVisible();
    await expect(page).toHaveURL(`/admin/announcements/${id}`);
    await expect(page.getByRole('region', { name: 'Publishing', exact: true })).toContainText(
      'SCHEDULED',
    );
    expect((await reader.request.get(`/api/announcements/${id}`)).status()).toBe(404);
    await edit();
    await page.getByTestId('announcement-edit-mode-now').check();
    await page.getByTestId('announcement-edit-submit').click();
    await expect(page.getByTestId('announcement-edit-dialog')).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'Publishing', exact: true })).toContainText(
      'PUBLISHED',
    );
    const original = (await (await page.request.get(`/api/admin/announcements/${id}`)).json()).data
      .publishAt;
    await reader.goto(`/announcements/${id}`);
    await expect(reader.getByTestId('announcement-detail-title')).toHaveText(title);
    await reader
      .getByRole('button', { name: 'Enlarge announcement attachment', exact: true })
      .click();
    await expect(
      reader.getByRole('dialog', { name: 'Announcement attachment', exact: true }),
    ).toBeVisible();
    await reader
      .getByRole('dialog')
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await edit();
    await page
      .getByTestId('announcement-edit-body')
      .fill('Edited community information without republishing.');
    await page.getByTestId('announcement-edit-submit').click();
    await expect(page.getByTestId('announcement-edit-dialog')).not.toBeVisible();
    const updated = (await (await page.request.get(`/api/admin/announcements/${id}`)).json()).data;
    expect(updated.publishAt).toBe(original);
    expect(updated.revisions.length).toBeGreaterThan(0);
    await edit();
    await page.getByTestId('announcement-edit-hide-btn').click();
    await expect(page.getByTestId('announcement-edit-hidden')).toBeVisible();
    await page.getByTestId('announcement-edit-dialog-close').click();
    expect((await reader.request.get(`/api/announcements/${id}`)).status()).toBe(404);
    await edit();
    await page.getByTestId('announcement-edit-restore-btn').click();
    await expect(page.getByTestId('announcement-edit-visible')).toHaveText('Visible');
    await page.getByTestId('announcement-edit-dialog-close').click();
    await reader.goto(`/announcements/${id}`);
    await expect(reader.getByTestId('announcement-detail-body')).toHaveText(
      'Edited community information without republishing.',
    );
    for (const width of [360, 768, 1366]) {
      await reader.setViewportSize({ width, height: 900 });
      expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await reader.screenshot({
        path: info.outputPath(`announcement-reader-${width}.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width, height: 900 });
      await edit();
      await page.screenshot({
        path: info.outputPath(`announcement-editor-${width}.png`),
        animations: 'disabled',
      });
      await page.getByTestId('announcement-edit-dialog-close').click();
    }
  } finally {
    await context.close();
  }
});

test('a tenant books a facility, cancels a slot and exchanges live chat messages and images with administration', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const building = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/buildings',
    body: { projectId: randomUUID(), name: `E2E-${runId}-Community`, status: 'ACTIVE' },
  });
  expect(building.status).toBe(200);
  const floor = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/floors',
    body: { buildingId: building.json.data.id, label: 'Community floor' },
  });
  expect(floor.status).toBe(200);
  const room = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/rooms',
    body: {
      buildingId: building.json.data.id,
      floorId: floor.json.data.id,
      name: `E2E-${runId}-CommunityRoom`,
      areaSqm: '30',
      status: 'ACTIVE',
    },
  });
  expect(room.status).toBe(200);
  const roomId = room.json.data.id;
  const tenancy = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: `/api/rooms/${roomId}/tenancies`,
    body: {
      startsAt: new Date(Date.now() - 86400000).toISOString(),
      managementMode: 'PROJECT_MANAGED',
    },
  });
  expect(tenancy.status).toBe(200);
  const username = runUsername(runId, `community`);
  const account = await provisionThroughUi(page, username, `E2E-${runId} Community tenant`);
  const member = await apiJson(page.request, {
    method: 'POST',
    path: `/api/rooms/${roomId}/members`,
    body: { userId: account.userId, memberRole: 'MAIN', tenancyId: tenancy.json.data.id },
  });
  expect(member.status).toBe(200);
  await page.goto('/admin/facilities');
  await page.getByRole('button', { name: 'New facility', exact: true }).click();
  await page.getByTestId('facility-create-name').fill(`E2E-${runId}-CommunityLounge`);
  for (let day = 0; day < 7; day += 1) await page.getByTestId(`facility-create-day-${day}`).check();
  const facilityAnswer = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/facilities') && response.request().method() === 'POST',
  );
  await page.getByTestId('facility-create-submit').click();
  const facilityResponse = await facilityAnswer;
  expect(facilityResponse.status()).toBe(200);
  const facilityId = (await facilityResponse.json()).data.id as string;
  const context = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  });
  try {
    const tenant = await context.newPage();
    await completeFirstLogin(tenant, {
      username,
      tempPassword: account.tempPassword,
      newPassword: `Community-${runId}-tenant-pw1`,
    });
    await tenant.goto(`/facilities/${facilityId}?roomId=${roomId}`);
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + 86400000));
    await tenant.getByTestId('slot-picker-date').fill(date);
    await expect(tenant.getByTestId('slot-picker-quota')).toContainText(date);
    await tenant.getByTestId('slot-picker-grid').getByRole('button').first().click();
    const bookingAnswer = tenant.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/facilities/${facilityId}/bookings`) &&
        response.request().method() === 'POST',
    );
    await tenant.getByTestId('slot-picker-submit').click();
    const bookingResponse = await bookingAnswer;
    expect(bookingResponse.status()).toBe(200);
    const booking = ((await bookingResponse.json()) as BookingEnvelope).data;
    const slotId = booking.slots[0]!.id;
    await expect(tenant).toHaveURL(`/rooms/${roomId}/bookings`);
    await tenant.getByTestId(`room-bookings-cancel-${slotId}-open`).click();
    await tenant
      .getByTestId(`room-bookings-cancel-${slotId}-reason`)
      .fill('Tenant no longer needs the lounge.');
    const cancellationAnswer = tenant.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/bookings/${booking.id}/slots/${slotId}/cancel`) &&
        response.request().method() === 'POST',
    );
    await tenant.getByTestId(`room-bookings-cancel-${slotId}-submit`).click();
    const cancellation = await cancellationAnswer;
    expect(cancellation.status()).toBe(200);
    expect(((await cancellation.json()) as BookingEnvelope).data.slots[0]!.state).toBe(
      'RESIDENT_CANCELLED',
    );
    await expect(tenant.getByTestId(`room-bookings-slot-${slotId}`)).toContainText('CANCELLED');
    await tenant.goto(`/rooms/${roomId}/chat`);
    await page.goto(`/admin/rooms/${roomId}/chat`);
    await expect(tenant.getByTestId('chat-connection')).toHaveText('Connected');
    await expect(page.getByTestId('admin-chat-connection')).toHaveText('Connected');
    for (let index = 0; index < 32; index += 1) {
      const sender = index % 2 === 0 ? tenant : page;
      const sent = await apiJson(sender.request, {
        method: 'POST',
        path: `/api/rooms/${roomId}/messages`,
        body: { clientMessageId: randomUUID(), text: `Community history ${index}` },
      });
      expect(sent.status).toBe(200);
    }
    await tenant.reload();
    await expect(tenant.getByTestId('chat-load-older')).toBeVisible();
    await tenant.getByTestId('chat-load-older').click();
    await expect(tenant.getByTestId('chat-list')).toContainText('Community history 0');
    const text = 'Could you check the lounge opening time?';
    await tenant.getByTestId('chat-composer-text').fill(text);
    await tenant.getByTestId('chat-composer-send').click();
    await expect(page.getByTestId('admin-chat-list')).toContainText(text);
    await page.getByTestId('admin-chat-composer-text').fill('The lounge opens at 9 AM.');
    await page.getByTestId('admin-chat-composer-send').click();
    await expect(tenant.getByTestId('chat-list')).toContainText('The lounge opens at 9 AM.');
    const photo = await buildValidImage('png', 32);
    await tenant
      .getByTestId('chat-composer-upload-input')
      .setInputFiles({ name: 'lounge.png', mimeType: 'image/png', buffer: photo.bytes });
    await expect(tenant.getByTestId('chat-composer-attachment')).toBeVisible();
    await tenant.getByTestId('chat-composer-send').click();
    await page.getByRole('button', { name: 'Open image preview', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Image preview', exact: true })).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    for (const [actor, prefix] of [
      [page, 'admin-chat'],
      [tenant, 'chat'],
    ] as const) {
      for (const width of [360, 768, 1366]) {
        await actor.setViewportSize({ width, height: 900 });
        expect(await actor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const composer = await actor.getByTestId(`${prefix}-composer`).boundingBox();
        expect(composer).not.toBeNull();
        expect(composer!.y + composer!.height).toBeLessThanOrEqual(901);
        await actor.screenshot({
          path: info.outputPath(`${prefix}-${width}.png`),
          animations: 'disabled',
        });
      }
    }
  } finally {
    await context.close();
  }
});
