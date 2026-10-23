import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { addDaysProjectDate, projectToday } from '../../helpers/dates';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import { loginAsAdmin } from '../../helpers/owner';
import { provisionResidentWithRetry } from '../../helpers/resident';
import {
  bookSlots,
  createFacility,
  findRoom,
  quotaFor,
  slotsFor,
  type BookingEnvelope,
} from './bookingFlow';

test.describe('booking golden path #3: browse, book, cancel middle', () => {
  test.setTimeout(180000);

  test('resident books consecutive slots and cancels the middle one', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);

    const facility = await createFacility(page, {
      code: `E2E-${ns}-GOLD`,
      name: `E2E ${ns} Golden Hall`,
    });
    const room102 = await findRoom(page, `E2E-${runId}-102`);
    const date = addDaysProjectDate(projectToday(), 2);

    const resident = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'booker',
      baseURL,
    });
    const residentPage = resident.page;

    const roomDetail = await apiJson<{ data: { tenancies: Array<{ id: string; state: string }> } }>(
      page.request,
      { method: 'GET', path: `/api/rooms/${room102}` },
    );
    expect(roomDetail.status).toBe(200);
    const activeTenancy = roomDetail.json.data.tenancies.find((tenancy) => tenancy.state === 'ACTIVE');
    expect(activeTenancy).toBeDefined();

    const added = await apiJson<{ data: { id: string } }>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room102}/members`,
      body: { username: resident.username, memberRole: 'SUB', tenancyId: activeTenancy?.id },
    });
    expect(added.status).toBe(200);

    const before = await slotsFor(residentPage, facility.id, date, room102);
    expect(before.slots.length).toBeGreaterThanOrEqual(3);
    const picked = before.slots.filter((slot) => slot.available).slice(0, 3);
    expect(picked).toHaveLength(3);

    const booked = await bookSlots(residentPage, facility.id, {
      roomId: room102,
      startsAt: picked.map((slot) => slot.startsAt),
    });
    expect(booked.slots).toHaveLength(3);
    expect(booked.slots.every((slot) => slot.state === 'CONFIRMED')).toBe(true);

    const quotaAfterBook = await quotaFor(residentPage, facility.id, room102, date);
    expect(quotaAfterBook.quotaUsed).toBeGreaterThanOrEqual(3);

    await residentPage.goto(`/facilities/${facility.id}?roomId=${room102}&date=${date}`);
    await expect(residentPage.getByTestId('facility-detail-page')).toBeVisible();
    await expect(residentPage.getByTestId('slot-picker-quota')).toContainText(
      `${quotaAfterBook.quotaUsed}/${quotaAfterBook.quotaLimit}`,
    );

    await residentPage.goto(`/rooms/${room102}/bookings`);
    await expect(residentPage.getByTestId('room-bookings-page')).toBeVisible();
    await expect(residentPage.getByTestId(`room-bookings-slot-${booked.slots[0]?.id}`)).toBeVisible();

    const middle = booked.slots[1];
    expect(middle).toBeDefined();
    const cancelled = await apiJson<BookingEnvelope>(residentPage.request, {
      method: 'POST',
      path: `/api/bookings/${booked.id}/slots/${middle?.id}/cancel`,
      body: { reason: `E2E ${ns} resident cancels middle slot` },
    });
    expect(cancelled.status).toBe(200);
    const states = new Map(cancelled.json.data.slots.map((slot) => [slot.id, slot.state]));
    expect(states.get(booked.slots[0]?.id ?? '')).toBe('CONFIRMED');
    expect(states.get(middle?.id ?? '')).toBe('RESIDENT_CANCELLED');
    expect(states.get(booked.slots[2]?.id ?? '')).toBe('CONFIRMED');

    const quotaAfterCancel = await quotaFor(residentPage, facility.id, room102, date);
    expect(quotaAfterCancel.quotaUsed).toBe(quotaAfterBook.quotaUsed);

    const after = await slotsFor(residentPage, facility.id, date, room102);
    const freed = after.slots.find((slot) => slot.startsAt === middle?.startsAt);
    expect(freed?.remaining).toBeGreaterThanOrEqual(1);

    await resident.close();
  });
});
