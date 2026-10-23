import { describe, expect, it } from 'vitest';
import {
  assertEffectiveAtAllowed,
  assertPreviewFresh,
  assertValidProposedConfig,
  diffConfig,
  isQuotaOnlyReduction,
  previewFingerprint,
  proposedConfigsEqual,
  type ConfigSnapshot,
  type ProposedConfig,
} from './configPolicy';
import type { FacilitySchedule } from './schedule';

function schedule(open: Array<[string, string]> = [['09:00', '17:00']]): FacilitySchedule {
  const closed = { open: [], breaks: [] };
  const weekday = { open: open.map(([start, end]) => ({ start, end })), breaks: [] };
  return {
    days: {
      '0': closed,
      '1': weekday,
      '2': weekday,
      '3': weekday,
      '4': weekday,
      '5': weekday,
      '6': closed,
    },
    holidays: [],
  };
}

function current(): ConfigSnapshot {
  return {
    version: 3,
    effectiveAt: new Date('2026-10-01T00:00:00.000Z'),
    scheduleJson: schedule(),
    slotMinutes: 60,
    capacity: 1,
    quotaKind: 'WEEKLY',
    quotaLimit: 5,
    advanceDays: 14,
  };
}

function proposed(overrides?: Partial<ProposedConfig>): ProposedConfig {
  return {
    schedule: schedule(),
    slotMinutes: 60,
    capacity: 1,
    quotaKind: 'WEEKLY',
    quotaLimit: 5,
    advanceDays: 14,
    ...overrides,
  };
}

describe('UT-FB-04 impact preview, stale preview, and quota-only reduction', () => {
  it('detects quota-only reduction versus structural changes', () => {
    const base = current();
    expect(isQuotaOnlyReduction(base, proposed({ quotaLimit: 2 }))).toBe(true);
    expect(isQuotaOnlyReduction(base, proposed({ quotaLimit: 8 }))).toBe(false);
    expect(isQuotaOnlyReduction(base, proposed({ quotaLimit: 2, capacity: 2 }))).toBe(false);
    expect(isQuotaOnlyReduction(base, proposed({ quotaLimit: 2, slotMinutes: 30 }))).toBe(false);
    expect(
      isQuotaOnlyReduction(base, proposed({ quotaLimit: 2, schedule: schedule([['10:00', '17:00']]) })),
    ).toBe(false);
    expect(isQuotaOnlyReduction(base, proposed({ quotaLimit: 2, quotaKind: 'DAILY' }))).toBe(false);
    const diff = diffConfig(base, proposed({ quotaLimit: 2 }));
    expect(diff).toEqual({
      scheduleChanged: false,
      slotMinutesChanged: false,
      capacityChanged: false,
      quotaKindChanged: false,
      quotaLimitChanged: true,
      advanceDaysChanged: false,
    });
  });

  it('treats jsonb key reorder as the same schedule', () => {
    const base = current();
    const reordered = JSON.parse(JSON.stringify(base.scheduleJson)) as typeof base.scheduleJson;
    const shuffled = {
      holidays: (reordered as { holidays: unknown }).holidays,
      days: Object.fromEntries(
        Object.entries((reordered as { days: Record<string, unknown> }).days).reverse(),
      ),
    };
    expect(
      isQuotaOnlyReduction({ ...base, scheduleJson: shuffled }, proposed({ quotaLimit: 2 })),
    ).toBe(true);
  });

  it('rejects malformed proposed configs without masking other validations', () => {
    expect(() => assertValidProposedConfig(proposed({ slotMinutes: 0 }))).toThrowError();
    expect(() => assertValidProposedConfig(proposed({ capacity: 0 }))).toThrowError();
    expect(() =>
      assertValidProposedConfig(proposed({ quotaKind: 'YEARLY' as ProposedConfig['quotaKind'] })),
    ).toThrowError();
    expect(() => assertValidProposedConfig(proposed({ quotaLimit: -1 }))).toThrowError();
    expect(() => assertValidProposedConfig(proposed({ advanceDays: -1 }))).toThrowError();
    const broken = proposed();
    (broken.schedule.days['1'] as { open: unknown }).open = [{ start: '25:00', end: '26:00' }];
    expect(() => assertValidProposedConfig(broken)).toThrowError();
    expect(() => assertValidProposedConfig(proposed())).not.toThrow();
  });

  it('validates effectiveAt against the server clock', () => {
    const now = new Date('2026-10-15T00:00:00.000Z');
    expect(() => assertEffectiveAtAllowed(new Date('2026-10-15T00:00:00.000Z'), now)).not.toThrow();
    expect(() => assertEffectiveAtAllowed(new Date('2026-10-16T00:00:00.000Z'), now)).not.toThrow();
    expect(() =>
      assertEffectiveAtAllowed(new Date('2026-10-14T23:59:59.999Z'), now),
    ).toThrowError();
  });

  it('detects stale previews when bookings change after preview', () => {
    const first = previewFingerprint({ configVersion: 3, confirmedFutureSlotIds: ['b', 'a'] });
    const same = previewFingerprint({ configVersion: 3, confirmedFutureSlotIds: ['a', 'b'] });
    const changed = previewFingerprint({ configVersion: 3, confirmedFutureSlotIds: ['a', 'b', 'c'] });
    const versioned = previewFingerprint({ configVersion: 4, confirmedFutureSlotIds: ['a', 'b'] });
    expect(first).toBe(same);
    expect(() => assertPreviewFresh(first, same)).not.toThrow();
    expect(() => assertPreviewFresh(first, changed)).toThrowError();
    expect(() => assertPreviewFresh(first, versioned)).toThrowError();
  });

  it('compares proposed configs without key-order sensitivity', () => {
    const left = proposed();
    const reorderedSchedule = JSON.parse(JSON.stringify(left.schedule)) as Record<string, unknown>;
    const days = Object.fromEntries(
      Object.entries(reorderedSchedule.days as Record<string, unknown>).reverse(),
    );
    const right: ProposedConfig = {
      advanceDays: left.advanceDays,
      quotaLimit: left.quotaLimit,
      quotaKind: left.quotaKind,
      capacity: left.capacity,
      slotMinutes: left.slotMinutes,
      schedule: { holidays: reorderedSchedule.holidays as string[], days: days as ProposedConfig['schedule']['days'] },
    };
    expect(proposedConfigsEqual(left, right)).toBe(true);
    expect(proposedConfigsEqual(left, proposed({ quotaLimit: 2 }))).toBe(false);
    expect(proposedConfigsEqual(proposed({ quotaLimit: 2 }), right)).toBe(false);
  });
});
