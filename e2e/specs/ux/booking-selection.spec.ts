import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { loginAsPoolAdmin } from '../../helpers/owner';
import { poolAdminFor, readRunContext } from '../../fixtures/run-context';
import { createFacility } from '../booking/bookingFlow';

test('booking availability follows the latest date and locks the selection while confirming', async ({
  page,
}) => {
  test.setTimeout(120000);
  await loginAsPoolAdmin(page, 'workspace');
  const context = await readRunContext();
  const { runId } = context;
  const building = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/buildings',
    body: { projectId: randomUUID(), name: `E2E-${runId}-BookingSelection`, status: 'ACTIVE' },
  });
  expect(building.status).toBe(200);
  const floor = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/floors',
    body: { buildingId: building.json.data.id, label: 'Booking floor' },
  });
  expect(floor.status).toBe(200);
  const room = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/rooms',
    body: {
      buildingId: building.json.data.id,
      floorId: floor.json.data.id,
      name: `E2E-${runId}-BookingRoom`,
      areaSqm: '30',
      status: 'ACTIVE',
    },
  });
  expect(room.status).toBe(200);
  const assigned = await apiJson(page.request, {
    method: 'POST',
    path: `/api/admin/rooms/${room.json.data.id}/owners`,
    body: { username: poolAdminFor(context, 'workspace').username },
  });
  expect(assigned.status).toBe(200);
  const facility = await createFacility(page, {
    code: `E2E-${runId}-Selection`,
    name: `E2E-${runId}-BookingSelection`,
  });
  const dateAfter = (days: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + days * 86400000));
  const earlierDate = dateAfter(1);
  const latestDate = dateAfter(2);
  let releaseEarlier = () => {};
  const earlierHeld = new Promise<void>((resolve) => {
    releaseEarlier = resolve;
  });
  let earlierReady = () => {};
  const earlierFetched = new Promise<void>((resolve) => {
    earlierReady = resolve;
  });
  await page.route(`**/api/facilities/${facility.id}/slots?**`, async (route) => {
    const response = await route.fetch();
    if (new URL(route.request().url()).searchParams.get('date') === earlierDate) {
      earlierReady();
      await earlierHeld;
    }
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/facilities/${facility.id}?roomId=${room.json.data.id}`);
    await expect(page.getByTestId('slot-picker-grid')).toBeVisible();
    await page.getByTestId('slot-picker-date').fill(earlierDate);
    await earlierFetched;
    await page.getByTestId('slot-picker-date').fill(latestDate);
    await expect(page.getByTestId('slot-picker-quota')).toContainText(latestDate);
    releaseEarlier();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('slot-picker-date')).toHaveValue(latestDate);
    await expect(page.getByTestId('slot-picker-quota')).toContainText(latestDate);

    await page.getByTestId('slot-picker-grid').getByRole('button').first().click();
    let releaseBooking = () => {};
    const bookingHeld = new Promise<void>((resolve) => {
      releaseBooking = resolve;
    });
    let bookingReady = () => {};
    const bookingFetched = new Promise<void>((resolve) => {
      bookingReady = resolve;
    });
    await page.route(`**/api/facilities/${facility.id}/bookings`, async (route) => {
      const response = await route.fetch();
      bookingReady();
      await bookingHeld;
      await route.fulfill({ response });
    });
    try {
      await page.getByTestId('slot-picker-submit').click();
      await bookingFetched;
      await expect(page.getByTestId('slot-picker-room')).toBeDisabled();
      await expect(page.getByTestId('slot-picker-date')).toBeDisabled();
      await expect(page.getByTestId('slot-picker-grid').getByRole('button').first()).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
      releaseBooking();
      await expect(page).toHaveURL(`/rooms/${room.json.data.id}/bookings`);
    } finally {
      releaseBooking();
    }
  } finally {
    releaseEarlier();
  }
});
