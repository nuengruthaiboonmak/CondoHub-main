import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { addDaysProjectDate, projectToday } from '../../helpers/dates';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import { loginAsAdmin } from '../../helpers/owner';
import { provisionResidentWithRetry } from '../../helpers/resident';
import {
  createFacility,
  findRoom,
  idempotencyKey,
  slotsFor,
  type BookingEnvelope,
  type QuotaEnvelope,
} from './bookingFlow';

test.describe('booking concurrency: double-book race keeps exactly one confirmed', () => {
  test.setTimeout(180000);
  test.describe.configure({ mode: 'serial' });

  test('two browsers race the last seat; capacity and quota hold', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);

    const facility = await createFacility(page, {
      code: `E2E-${ns}-RACE`,
      name: `E2E ${ns} Race Court`,
      capacity: 1,
      quotaLimit: 10,
    });
    const room102 = await findRoom(page, `E2E-${runId}-102`);
    const room104 = await findRoom(page, `E2E-${runId}-104`);
    const date = addDaysProjectDate(projectToday(), 3);

    const contestantA = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'racerA',
      baseURL,
    });
    const contestantB = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'racerB',
      baseURL,
    });

    const roomADetail = await apiJson<{ data: { tenancies: Array<{ id: string; state: string }> } }>(
      page.request,
      { method: 'GET', path: `/api/rooms/${room102}` },
    );
    const tenancyA = roomADetail.json.data.tenancies.find((tenancy) => tenancy.state === 'ACTIVE');
    const roomBDetail = await apiJson<{ data: { tenancies: Array<{ id: string; state: string }> } }>(
      page.request,
      { method: 'GET', path: `/api/rooms/${room104}` },
    );
    const tenancyB = roomBDetail.json.data.tenancies.find((tenancy) => tenancy.state === 'ACTIVE');
    expect(tenancyA).toBeDefined();

    const joinA = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room102}/members`,
      body: { username: contestantA.username, memberRole: 'SUB', tenancyId: tenancyA?.id },
    });
    expect(joinA.status).toBe(200);
    if (tenancyB !== undefined) {
      const joinB = await apiJson<unknown>(page.request, {
        method: 'POST',
        path: `/api/rooms/${room104}/members`,
        body: { username: contestantB.username, memberRole: 'SUB', tenancyId: tenancyB.id },
      });
      expect(joinB.status).toBe(200);
    } else {
      const joinB = await apiJson<unknown>(page.request, {
        method: 'POST',
        path: `/api/rooms/${room104}/members`,
        body: { username: contestantB.username, memberRole: 'SUB' },
      });
      expect(joinB.status).toBe(200);
    }

    const availability = await slotsFor(contestantA.page, facility.id, date, room102);
    const target = availability.slots.find((slot) => slot.available);
    expect(target).toBeDefined();
    const startsAt = target?.startsAt ?? '';

    const [first, second] = await Promise.all([
      apiJson<BookingEnvelope | { error: { code: string } }>(contestantA.page.request, {
        method: 'POST',
        path: `/api/facilities/${facility.id}/bookings`,
        body: { roomId: room102, startsAt: [startsAt] },
        headers: { 'Idempotency-Key': idempotencyKey() },
      }),
      apiJson<BookingEnvelope | { error: { code: string } }>(contestantB.page.request, {
        method: 'POST',
        path: `/api/facilities/${facility.id}/bookings`,
        body: { roomId: room104, startsAt: [startsAt] },
        headers: { 'Idempotency-Key': idempotencyKey() },
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect((loser.json as { error: { code: string } }).error.code).toBe('BOOKING_SLOT_UNAVAILABLE');

    const confirmed = await apiJson<{ data: { bookings: Array<{ slots: Array<{ startsAt: string; state: string }> }> } }>(
      page.request,
      { method: 'GET', path: `/api/admin/facilities/${facility.id}/bookings` },
    );
    expect(confirmed.status).toBe(200);
    const winners = confirmed.json.data.bookings.flatMap((booking) =>
      booking.slots.filter((slot) => slot.startsAt === startsAt && slot.state === 'CONFIRMED'),
    );
    expect(winners).toHaveLength(1);

    const quotaA = await apiJson<QuotaEnvelope>(contestantA.page.request, {
      method: 'GET',
      path: `/api/facilities/${facility.id}/quota?roomId=${room102}&date=${date}`,
    });
    expect(quotaA.json.data.quotaUsed).toBeLessThanOrEqual(1);

    await contestantA.close();
    await contestantB.close();
  });
});
