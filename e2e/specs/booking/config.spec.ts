import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { addDaysProjectDate, projectToday } from '../../helpers/dates';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import { loginAsAdmin } from '../../helpers/owner';
import {
  bookSlots,
  daytimeSchedule,
  findRoom,
  idempotencyKey,
  quotaFor,
  slotsFor,
} from './bookingFlow';

interface PreviewEnvelope {
  data: {
    configVersion: number;
    effectiveAt: string;
    quotaOnlyReduction: boolean;
    structuralConflicts: Array<{ id: string; conflicts: string[] }>;
    quotaImpacts: Array<{ roomId: string; used: number; newLimit: number }>;
    previewToken: string;
  };
}

interface CommitEnvelope {
  data: { configId: string; version: number; quotaOnlyReduction: boolean };
}

interface FacilityEnvelope {
  data: {
    id: string;
    name: string;
    capacity: number;
    effectiveConfig: { version: number; quotaLimit: number; quotaKind: string } | null;
    closures: Array<{ id: string }>;
  };
}

function previewBody(input: { quotaLimit: number; days?: number }): Record<string, unknown> {
  return {
    schedule: { days: daytimeSchedule(), holidays: [] },
    slotMinutes: 60,
    capacity: 2,
    quotaKind: 'WEEKLY',
    quotaLimit: input.quotaLimit,
    advanceDays: 30,
    effectiveAt: new Date(Date.now() + (input.days ?? 1) * 86_400_000).toISOString(),
  };
}

test.describe('booking admin: config preview/commit, closures, and D08-A reduction', () => {
  test.setTimeout(180000);

  test('quota-only reduction applies without cancelling; stale preview conflicts; closure blocks slots', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsAdmin(page);

    const created = await apiJson<FacilityEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/facilities',
      body: {
        projectId: '00000000-0000-4000-8000-000000000001',
        code: `E2E-${ns}-CFG`,
        name: `E2E ${ns} Config Arena`,
        description: 'Config flow fixture.',
        status: 'ACTIVE',
        capacity: 2,
        schedule: { days: daytimeSchedule(), holidays: [] },
        slotMinutes: 60,
        quotaKind: 'WEEKLY',
        quotaLimit: 5,
        advanceDays: 30,
      },
    });
    expect(created.status).toBe(200);
    const facilityId = created.json.data.id;

    const patched = await apiJson<FacilityEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/facilities/${facilityId}`,
      body: { name: `E2E ${ns} Config Arena Renamed` },
    });
    expect(patched.status).toBe(200);
    expect(patched.json.data.name).toContain('Renamed');

    const detail = await apiJson<FacilityEnvelope>(page.request, {
      method: 'GET',
      path: `/api/admin/facilities/${facilityId}`,
    });
    expect(detail.status).toBe(200);
    expect(detail.json.data.effectiveConfig?.quotaLimit).toBe(5);

    const room102 = await findRoom(page, `E2E-${runId}-102`);
    const date = addDaysProjectDate(projectToday(), 5);
    const availability = await slotsFor(page, facilityId, date, room102);
    const picked = availability.slots.filter((slot) => slot.available).slice(0, 4);
    expect(picked.length).toBeGreaterThanOrEqual(4);
    await bookSlots(page, facilityId, {
      roomId: room102,
      startsAt: picked.map((slot) => slot.startsAt),
    });

    const firstBody = previewBody({ quotaLimit: 2 });
    const preview = await apiJson<PreviewEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/config-preview`,
      body: firstBody,
    });
    expect(preview.status).toBe(200);
    expect(preview.json.data.quotaOnlyReduction).toBe(true);
    expect(preview.json.data.structuralConflicts).toHaveLength(0);
    expect(
      preview.json.data.quotaImpacts.some((impact) => impact.roomId === room102 && impact.used === 4),
    ).toBe(true);

    const extra = availability.slots.filter((slot) => slot.available).slice(4, 5);
    expect(extra).toHaveLength(1);
    await bookSlots(page, facilityId, {
      roomId: room102,
      startsAt: extra.map((slot) => slot.startsAt),
    });

    const stale = await apiJson<{ error: { code: string } }>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/config-commit`,
      body: { ...firstBody, previewToken: preview.json.data.previewToken },
      headers: { 'Idempotency-Key': idempotencyKey() },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('CONFIG_IMPACT_CHANGED');

    const freshBody = previewBody({ quotaLimit: 2 });
    const fresh = await apiJson<PreviewEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/config-preview`,
      body: freshBody,
    });
    expect(fresh.status).toBe(200);
    const commitKey = idempotencyKey();
    const committed = await apiJson<CommitEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/config-commit`,
      body: { ...freshBody, previewToken: fresh.json.data.previewToken },
      headers: { 'Idempotency-Key': commitKey },
    });
    expect(committed.status).toBe(200);
    expect(committed.json.data.quotaOnlyReduction).toBe(true);

    const replayCommit = await apiJson<CommitEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/config-commit`,
      body: { ...freshBody, previewToken: fresh.json.data.previewToken },
      headers: { 'Idempotency-Key': commitKey },
    });
    expect(replayCommit.status).toBe(200);
    expect(replayCommit.json.data.configId).toBe(committed.json.data.configId);

    const secondBody = previewBody({ quotaLimit: 1 });
    const secondPreview = await apiJson<PreviewEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/config-preview`,
      body: secondBody,
    });
    expect(secondPreview.status).toBe(200);
    const secondPending = await apiJson<{ error: { code: string } }>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/config-commit`,
      body: { ...secondBody, previewToken: secondPreview.json.data.previewToken },
      headers: { 'Idempotency-Key': idempotencyKey() },
    });
    expect(secondPending.status).toBe(409);
    expect(secondPending.json.error.code).toBe('VERSION_CONFLICT');

    const bookings = await apiJson<{ data: { bookings: Array<{ slots: Array<{ state: string; startsAt: string }> }> } }>(
      page.request,
      { method: 'GET', path: `/api/admin/facilities/${facilityId}/bookings` },
    );
    expect(bookings.status).toBe(200);
    const confirmed = bookings.json.data.bookings.flatMap((booking) =>
      booking.slots.filter((slot) => slot.state === 'CONFIRMED'),
    );
    expect(confirmed.length).toBeGreaterThanOrEqual(5);

    const closureDate = addDaysProjectDate(projectToday(), 6);
    const beforeClosure = await slotsFor(page, facilityId, closureDate, room102);
    const target = beforeClosure.slots.find((slot) => slot.available);
    expect(target).toBeDefined();
    const closureStart = new Date(target?.startsAt ?? '');
    const closureEnd = new Date(target?.endsAt ?? '');
    const closure = await apiJson<{ data: { id: string } }>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/closures`,
      body: {
        startsAt: closureStart.toISOString(),
        endsAt: closureEnd.toISOString(),
        reason: `E2E ${ns} maintenance closure`,
      },
    });
    expect(closure.status).toBe(200);

    const afterDetail = await apiJson<FacilityEnvelope>(page.request, {
      method: 'GET',
      path: `/api/admin/facilities/${facilityId}`,
    });
    expect(afterDetail.json.data.closures.some((row) => row.id === closure.json.data.id)).toBe(true);

    const afterClosure = await slotsFor(page, facilityId, closureDate, room102);
    const beforeStarts = new Set(beforeClosure.slots.map((slot) => slot.startsAt));
    const afterStarts = new Set(afterClosure.slots.map((slot) => slot.startsAt));
    expect(beforeStarts.has(target?.startsAt ?? '')).toBe(true);
    expect(afterStarts.has(target?.startsAt ?? '')).toBe(false);
    expect(afterClosure.slots.length).toBe(beforeClosure.slots.length - 1);

    const blocked = await apiJson<{ error: { code: string } }>(page.request, {
      method: 'POST',
      path: `/api/facilities/${facilityId}/bookings`,
      body: { roomId: room102, startsAt: [target?.startsAt] },
      headers: { 'Idempotency-Key': idempotencyKey() },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe('BOOKING_SLOT_UNAVAILABLE');

    const quota = await quotaFor(page, facilityId, room102, date);
    expect(quota.quotaUsed).toBe(5);

    await page.goto(`/admin/facilities/${facilityId}`);
    await expect(page.getByTestId('admin-facility-detail-page')).toBeVisible();
    await expect(page.getByTestId('admin-facility-detail-title')).toContainText('Config Arena Renamed');
    await expect(page.getByTestId('admin-facility-closures')).toBeVisible();
  });

  test('MS-BOOK-03: quota-only cut gates same-cycle but next cycle books fresh', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsAdmin(page);

    const created = await apiJson<FacilityEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/facilities',
      body: {
        projectId: '00000000-0000-4000-8000-000000000001',
        code: `E2E-${ns}-MSB3`,
        name: `E2E ${ns} MS-BOOK-03 Arena`,
        description: 'MS-BOOK-03 D08-A fixture.',
        status: 'ACTIVE',
        capacity: 2,
        schedule: { days: daytimeSchedule(), holidays: [] },
        slotMinutes: 60,
        quotaKind: 'WEEKLY',
        quotaLimit: 5,
        advanceDays: 30,
      },
    });
    expect(created.status).toBe(200);
    const facilityId = created.json.data.id;

    const room102 = await findRoom(page, `E2E-${runId}-102`);
    const weekADate = addDaysProjectDate(projectToday(), 5);
    const weekBDate = addDaysProjectDate(projectToday(), 12);
    const availability = await slotsFor(page, facilityId, weekADate, room102);
    const picked = availability.slots.filter((slot) => slot.available).slice(0, 5);
    expect(picked.length).toBeGreaterThanOrEqual(5);
    await bookSlots(page, facilityId, {
      roomId: room102,
      startsAt: picked.slice(0, 4).map((slot) => slot.startsAt),
    });

    const cutBody = {
      schedule: { days: daytimeSchedule(), holidays: [] },
      slotMinutes: 60,
      capacity: 2,
      quotaKind: 'WEEKLY',
      quotaLimit: 2,
      advanceDays: 30,
      effectiveAt: new Date(Date.now() + 15_000).toISOString(),
    };
    const preview = await apiJson<PreviewEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/config-preview`,
      body: cutBody,
    });
    expect(preview.status).toBe(200);
    expect(preview.json.data.quotaOnlyReduction).toBe(true);
    expect(preview.json.data.structuralConflicts).toHaveLength(0);

    const committed = await apiJson<CommitEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/facilities/${facilityId}/config-commit`,
      body: { ...cutBody, previewToken: preview.json.data.previewToken },
      headers: { 'Idempotency-Key': idempotencyKey() },
    });
    expect(committed.status).toBe(200);
    expect(committed.json.data.quotaOnlyReduction).toBe(true);

    const bookings = await apiJson<{ data: { bookings: Array<{ slots: Array<{ state: string }> }> } }>(
      page.request,
      { method: 'GET', path: `/api/admin/facilities/${facilityId}/bookings` },
    );
    expect(bookings.status).toBe(200);
    const survived = bookings.json.data.bookings.flatMap((booking) =>
      booking.slots.filter((slot) => slot.state === 'CONFIRMED'),
    );
    expect(survived).toHaveLength(4);

    let effectiveVersion = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const polled = await apiJson<FacilityEnvelope>(page.request, {
        method: 'GET',
        path: `/api/admin/facilities/${facilityId}`,
      });
      effectiveVersion = polled.json.data.effectiveConfig?.version ?? 0;
      if (effectiveVersion === 2) break;
      await page.waitForTimeout(1000);
    }
    expect(effectiveVersion).toBe(2);

    const weekAQuota = await quotaFor(page, facilityId, room102, weekADate);
    expect(weekAQuota.quotaUsed).toBe(4);
    expect(weekAQuota.quotaLimit).toBe(2);

    const gated = await apiJson<{ error: { code: string } }>(page.request, {
      method: 'POST',
      path: `/api/facilities/${facilityId}/bookings`,
      body: { roomId: room102, startsAt: [picked[4]?.startsAt] },
      headers: { 'Idempotency-Key': idempotencyKey() },
    });
    expect(gated.status).toBe(409);
    expect(gated.json.error.code).toBe('BOOKING_QUOTA_EXCEEDED');

    const weekBBefore = await quotaFor(page, facilityId, room102, weekBDate);
    expect(weekBBefore.periodKey).not.toBe(weekAQuota.periodKey);
    expect(weekBBefore.quotaUsed).toBe(0);
    const weekB = await slotsFor(page, facilityId, weekBDate, room102);
    const weekBPicked = weekB.slots.filter((slot) => slot.available).slice(0, 2);
    expect(weekBPicked).toHaveLength(2);
    await bookSlots(page, facilityId, {
      roomId: room102,
      startsAt: weekBPicked.map((slot) => slot.startsAt),
    });
    const weekBAfter = await quotaFor(page, facilityId, room102, weekBDate);
    expect(weekBAfter.quotaUsed).toBe(2);
  });
});
