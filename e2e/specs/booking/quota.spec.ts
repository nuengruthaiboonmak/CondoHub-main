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
  idempotencyKey,
  quotaFor,
  slotsFor,
  type BookingEnvelope,
} from './bookingFlow';

test.describe('booking quota, cancel, refund, and idempotency', () => {
  test.setTimeout(180000);

  test('quota fills, N+1 rejects, no-refund cancel burns, admin refund restores, replay replays', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsAdmin(page);

    const facility = await createFacility(page, {
      code: `E2E-${ns}-QUOTA`,
      name: `E2E ${ns} Quota Gym`,
      capacity: 4,
      quotaLimit: 2,
    });
    const room102 = await findRoom(page, `E2E-${runId}-102`);
    const date = addDaysProjectDate(projectToday(), 4);

    const availability = await slotsFor(page, facility.id, date, room102);
    const picked = availability.slots.filter((slot) => slot.available).slice(0, 4);
    expect(picked.length).toBeGreaterThanOrEqual(4);

    const key = idempotencyKey();
    const first = await apiJson<BookingEnvelope>(page.request, {
      method: 'POST',
      path: `/api/facilities/${facility.id}/bookings`,
      body: { roomId: room102, startsAt: [picked[0]?.startsAt, picked[1]?.startsAt] },
      headers: { 'Idempotency-Key': key },
    });
    expect(first.status).toBe(200);
    const bookingId = first.json.data.id;

    const replay = await apiJson<BookingEnvelope>(page.request, {
      method: 'POST',
      path: `/api/facilities/${facility.id}/bookings`,
      body: { roomId: room102, startsAt: [picked[0]?.startsAt, picked[1]?.startsAt] },
      headers: { 'Idempotency-Key': key },
    });
    expect(replay.status).toBe(200);
    expect(replay.json.data.id).toBe(bookingId);

    const mismatch = await apiJson<{ error: { code: string } }>(page.request, {
      method: 'POST',
      path: `/api/facilities/${facility.id}/bookings`,
      body: { roomId: room102, startsAt: [picked[2]?.startsAt] },
      headers: { 'Idempotency-Key': key },
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.json.error.code).toBe('VALIDATION_ERROR');

    const quotaFull = await quotaFor(page, facility.id, room102, date);
    expect(quotaFull.quotaUsed).toBe(2);

    const overflow = await apiJson<{ error: { code: string } }>(page.request, {
      method: 'POST',
      path: `/api/facilities/${facility.id}/bookings`,
      body: { roomId: room102, startsAt: [picked[2]?.startsAt] },
      headers: { 'Idempotency-Key': idempotencyKey() },
    });
    expect(overflow.status).toBe(409);
    expect(overflow.json.error.code).toBe('BOOKING_QUOTA_EXCEEDED');

    const noRefundCancel = await apiJson<BookingEnvelope>(page.request, {
      method: 'POST',
      path: `/api/bookings/${bookingId}/slots/${first.json.data.slots[0]?.id}/cancel`,
      body: { reason: `E2E ${ns} cancel without refund burns quota` },
    });
    expect(noRefundCancel.status).toBe(200);
    const burned = noRefundCancel.json.data.slots.find(
      (slot) => slot.id === first.json.data.slots[0]?.id,
    );
    expect(burned?.refundQuota).toBe(false);

    const quotaAfterNoRefundCancel = await quotaFor(page, facility.id, room102, date);
    expect(quotaAfterNoRefundCancel.quotaUsed).toBe(2);

    const adminCancel = await apiJson<BookingEnvelope>(page.request, {
      method: 'POST',
      path: `/api/bookings/${bookingId}/slots/${first.json.data.slots[1]?.id}/cancel`,
      body: { reason: `E2E ${ns} admin refund restores quota`, refundQuota: true },
    });
    expect(adminCancel.status).toBe(200);
    const refunded = adminCancel.json.data.slots.find(
      (slot) => slot.id === first.json.data.slots[1]?.id,
    );
    expect(refunded?.state).toBe('ADMIN_CANCELLED');
    expect(refunded?.refundQuota).toBe(true);

    const quotaAfterRefund = await quotaFor(page, facility.id, room102, date);
    expect(quotaAfterRefund.quotaUsed).toBe(1);

    const rebooked = await bookSlots(page, facility.id, {
      roomId: room102,
      startsAt: [picked[3]?.startsAt ?? ''],
    });
    expect(rebooked.slots).toHaveLength(1);

    const quotaFinal = await quotaFor(page, facility.id, room102, date);
    expect(quotaFinal.quotaUsed).toBe(2);
  });

  test('unentitled resident sees 404 concealment on slots, quota, booking, and list', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);

    const facility = await createFacility(page, {
      code: `E2E-${ns}-NOACC`,
      name: `E2E ${ns} Noaccess Gym`,
      capacity: 2,
      quotaLimit: 10,
    });
    const room102 = await findRoom(page, `E2E-${runId}-102`);
    const date = addDaysProjectDate(projectToday(), 4);
    const probe = await slotsFor(page, facility.id, date, room102);
    const sample = probe.slots.find((slot) => slot.available);
    expect(sample).toBeDefined();

    const resident = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'noaccess',
      baseURL,
    });
    try {
      const slots = await apiJson<{ error: { code: string } }>(resident.page.request, {
        method: 'GET',
        path: `/api/facilities/${facility.id}/slots?date=${date}&roomId=${room102}`,
      });
      expect(slots.status).toBe(404);
      expect(slots.json.error.code).toBe('RESOURCE_NOT_FOUND');

      const quota = await apiJson<{ error: { code: string } }>(resident.page.request, {
        method: 'GET',
        path: `/api/facilities/${facility.id}/quota?roomId=${room102}&date=${date}`,
      });
      expect(quota.status).toBe(404);
      expect(quota.json.error.code).toBe('RESOURCE_NOT_FOUND');

      const booking = await apiJson<{ error: { code: string } }>(resident.page.request, {
        method: 'POST',
        path: `/api/facilities/${facility.id}/bookings`,
        body: { roomId: room102, startsAt: [sample?.startsAt] },
        headers: { 'Idempotency-Key': idempotencyKey() },
      });
      expect(booking.status).toBe(404);
      expect(booking.json.error.code).toBe('RESOURCE_NOT_FOUND');

      const listed = await apiJson<{ error: { code: string } }>(resident.page.request, {
        method: 'GET',
        path: `/api/bookings?roomId=${room102}`,
      });
      expect(listed.status).toBe(404);
      expect(listed.json.error.code).toBe('RESOURCE_NOT_FOUND');
    } finally {
      await resident.close();
    }
  });
});
