import { expect, test, type Page } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { addDaysProjectDate, projectToday } from '../../helpers/dates';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import { loginAsAdmin } from '../../helpers/owner';
import { provisionResidentWithRetry } from '../../helpers/resident';
import { bookSlots, createFacility, findRoom, slotsFor } from './bookingFlow';

const VIEWPORTS = [
  { width: 1366, height: 900 },
  { width: 768, height: 900 },
  { width: 360, height: 800 },
] as const;

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const bad: string[] = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && (rect.left < -1 || rect.right > vw + 1)) {
        const testid = el.getAttribute('data-testid');
        bad.push(
          `${el.tagName}${testid === null ? '' : `#${testid}`}@${Math.round(rect.left)},${Math.round(rect.right)}/${vw}`,
        );
        if (bad.length >= 10) break;
      }
    }
    return { vw, scrollWidth: document.body.scrollWidth, bad };
  });
  expect(overflow.bad, `overflow at ${overflow.vw}px`).toEqual([]);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.vw + 1);
}

test.describe('booking browser gate: six screens at 1366/768/360', () => {
  test.setTimeout(240000);
  test.describe.configure({ mode: 'serial' });

  test('resident list + detail + room bookings: states, keyboard, zero-overflow', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);

    const longName = `E2E ${ns} Maple Residences Tower of Enduring Harmony and Perpetual Serenity by the Riverside Gardens Extension Block C Wing D Unit Corridor North`;
    const facility = await createFacility(page, {
      code: `E2E-${ns}-GATE`,
      name: longName,
      capacity: 2,
      quotaLimit: 10,
    });
    const room102 = await findRoom(page, `E2E-${runId}-102`);
    const date = addDaysProjectDate(projectToday(), 6);

    const resident = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'gater',
      baseURL,
    });
    const ui = resident.page;

    const roomDetail = await apiJson<{ data: { tenancies: Array<{ id: string; state: string }> } }>(
      page.request,
      { method: 'GET', path: `/api/rooms/${room102}` },
    );
    const activeTenancy = roomDetail.json.data.tenancies.find(
      (tenancy) => tenancy.state === 'ACTIVE',
    );
    expect(activeTenancy).toBeDefined();
    const added = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room102}/members`,
      body: { username: resident.username, memberRole: 'SUB', tenancyId: activeTenancy?.id },
    });
    expect(added.status).toBe(200);

    const seedAvailability = await slotsFor(ui, facility.id, date, room102);
    const booked = await bookSlots(ui, facility.id, {
      roomId: room102,
      startsAt: seedAvailability.slots
        .filter((slot) => slot.available)
        .slice(0, 1)
        .map((slot) => slot.startsAt),
    });
    expect(booked.slots).toHaveLength(1);

    await ui.goto(`/facilities/${facility.id}?roomId=${room102}&date=${date}`);
    await expect(ui.getByTestId('slot-picker-quota')).toBeVisible();
    const slotButtons = ui.locator('[data-testid^="slot-picker-slot-"]:not([disabled])');
    expect(await slotButtons.count()).toBeGreaterThanOrEqual(1);
    await slotButtons.nth(1).focus();
    await ui.keyboard.press('Enter');
    await expect(ui.getByTestId('slot-picker-submit')).toContainText('Confirm 1 slot');
    await ui.getByTestId('slot-picker-submit').focus();
    await ui.keyboard.press('Enter');
    await expect(ui.getByTestId('room-bookings-page')).toBeVisible({ timeout: 15000 });
    const bookedViaUi = ui.getByTestId('room-bookings-list');
    await expect(bookedViaUi).toBeVisible();

    const facilitiesListed = await apiJson<{ data: Array<{ id: string }> }>(ui.request, {
      method: 'GET',
      path: '/api/facilities?status=ACTIVE&pageSize=100',
    });
    expect(facilitiesListed.status).toBe(200);
    expect(facilitiesListed.json.data.some((row) => row.id === facility.id)).toBe(true);

    const roomBookingsListed = await apiJson<{ data: { bookings: Array<{ id: string }> } }>(
      ui.request,
      {
        method: 'GET',
        path: `/api/bookings?roomId=${room102}`,
      },
    );
    expect(roomBookingsListed.status).toBe(200);
    expect(roomBookingsListed.json.data.bookings.length).toBeGreaterThanOrEqual(2);

    for (const viewport of VIEWPORTS) {
      await ui.setViewportSize(viewport);
      await ui.goto('/facilities');
      await expect(ui.getByTestId('facilities-page')).toBeVisible();
      await expect(ui.getByTestId('facilities-list')).toBeVisible();
      await expectNoOverflow(ui);

      await ui.goto(`/facilities/${facility.id}?roomId=${room102}&date=${date}`);
      await expect(ui.getByTestId('facility-detail-page')).toBeVisible();
      await expect(ui.getByTestId('slot-picker-grid')).toBeVisible();
      await expect(ui.getByTestId('facility-detail-title')).toContainText('Maple Residences Tower');
      await expectNoOverflow(ui);

      await ui.goto(`/rooms/${room102}/bookings`);
      await expect(ui.getByTestId('room-bookings-page')).toBeVisible();
      await expect(ui.getByTestId('room-bookings-list')).toBeVisible();
      await expect(ui.getByTestId('room-bookings-quotas')).toBeVisible();
      await expectNoOverflow(ui);
    }

    await resident.close();
  });

  test('admin list + new + detail: create/commit/closure flows, zero-overflow', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsAdmin(page);

    const room102 = await findRoom(page, `E2E-${runId}-102`);

    await page.goto('/admin/facilities/new');
    await expect(page.getByTestId('admin-facility-new-page')).toBeVisible();
    await page.getByTestId('facility-create-name').fill(`E2E ${ns} UI Gate Arena`);
    await page.getByTestId('facility-create-quota-limit').fill('5');
    await page.getByTestId('facility-create-day-6').check();
    await page.getByTestId('facility-create-day-0').check();
    await page.getByTestId('facility-create-submit').click();
    await expect(page.getByTestId('admin-facilities-list')).toBeVisible({ timeout: 15000 });
    const createdRow = page.getByText(`E2E ${ns} UI Gate Arena`);
    await expect(createdRow).toBeVisible();
    const rowTestId = await page
      .locator(`[data-testid^="admin-facilities-row-"]:has-text("E2E ${ns} UI Gate Arena")`)
      .first()
      .getAttribute('data-testid');
    const facilityId = (rowTestId ?? '').replace('admin-facilities-row-', '');
    expect(facilityId.length).toBeGreaterThan(10);

    await page.goto(`/admin/facilities/${facilityId}`);
    await expect(page.getByTestId('admin-facility-detail-page')).toBeVisible();
    await page.getByTestId('facility-actions-trigger').click();
    await page.getByTestId('facility-edit-open').click();
    await expect(page.getByTestId('facility-edit-form')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('config-change-open').click();
    const effectiveAt = new Date(Date.now() + 7 * 86_400_000);
    const pad = (value: number): string => String(value).padStart(2, '0');
    await page
      .getByTestId('config-change-effective-at')
      .fill(
        `${effectiveAt.getFullYear()}-${pad(effectiveAt.getMonth() + 1)}-${pad(effectiveAt.getDate())}T${pad(effectiveAt.getHours())}:${pad(effectiveAt.getMinutes())}`,
      );
    await page.getByTestId('config-change-preview').click();
    await expect(page.getByTestId('config-change-preview-result')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('config-change-no-conflicts')).toBeVisible();
    await page.getByTestId('config-change-commit').click();
    await expect(page.getByTestId('admin-facility-pending')).toBeVisible({ timeout: 15000 });

    const closureStart = new Date(Date.now() + 8 * 86_400_000);
    const closureEnd = new Date(closureStart.getTime() + 2 * 3_600_000);
    const toLocal = (value: Date): string =>
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
    await page.getByTestId('closure-create-open').click();
    await page.getByTestId('closure-create-start').fill(toLocal(closureStart));
    await page.getByTestId('closure-create-end').fill(toLocal(closureEnd));
    await page.getByTestId('closure-create-reason').fill(`E2E ${ns} gate closure`);
    await page.getByTestId('closure-create-submit').click();
    await expect(page.getByTestId('admin-facility-closures')).toBeVisible({ timeout: 15000 });

    const adminAvailability = await slotsFor(
      page,
      facilityId,
      addDaysProjectDate(projectToday(), 6),
      room102,
    );
    const booked = await bookSlots(page, facilityId, {
      roomId: room102,
      startsAt: adminAvailability.slots
        .filter((slot) => slot.available)
        .slice(0, 1)
        .map((slot) => slot.startsAt),
    });
    expect(booked.slots).toHaveLength(1);
    const slot = booked.slots[0];
    expect(slot).toBeDefined();
    await page.goto(`/admin/facilities/${facilityId}`);
    await expect(page.getByTestId(`admin-facility-slot-${slot?.id}`)).toBeVisible();
    await page.getByTestId(`admin-facility-cancel-${slot?.id}-open`).click();
    await page
      .getByTestId(`admin-facility-cancel-${slot?.id}-reason`)
      .fill(`E2E ${ns} gate admin cancel`);
    await page.getByTestId(`admin-facility-cancel-${slot?.id}-refund`).check();
    await page.getByTestId(`admin-facility-cancel-${slot?.id}-submit`).click();
    await expect(page.getByTestId(`admin-facility-slot-${slot?.id}`)).toContainText(
      'ADMIN_CANCELLED',
      { timeout: 15000 },
    );

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto('/admin/facilities');
      await expect(page.getByTestId('admin-facilities-page')).toBeVisible();
      await expect(page.getByTestId('admin-facilities-list')).toBeVisible();
      await expectNoOverflow(page);

      await page.goto('/admin/facilities/new');
      await expect(page.getByTestId('admin-facility-new-page')).toBeVisible();
      await expect(page.getByTestId('facility-create-form')).toBeVisible();
      await expectNoOverflow(page);

      await page.goto(`/admin/facilities/${facilityId}`);
      await expect(page.getByTestId('admin-facility-detail-page')).toBeVisible();
      await page.getByTestId('config-change-open').click();
      await expect(page.getByTestId('config-change-form')).toBeVisible();
      await expectNoOverflow(page);
      await page.keyboard.press('Escape');
      await page.getByTestId('closure-create-open').click();
      await expect(page.getByTestId('closure-create-form')).toBeVisible();
      await expectNoOverflow(page);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('admin-facility-bookings')).toBeVisible();
      await expectNoOverflow(page);
    }
  });

  test('empty and missing states render without overflow', async ({ page }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsAdmin(page);
    void ns;
    void runId;

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto('/facilities/00000000-0000-4000-8000-000000000099');
      await expect(page.getByTestId('facility-detail-missing')).toBeVisible();
      await expectNoOverflow(page);
    }
  });
});
