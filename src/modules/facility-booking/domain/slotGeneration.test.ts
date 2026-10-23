import { describe, expect, it } from 'vitest';
import {
  generateSlotsForDate,
  resolveSlotCapacity,
  selectEffectiveConfig,
  type DaySchedule,
  type FacilitySchedule,
  type WeekdayKey,
} from './schedule';

const TIME_ZONE = 'Asia/Bangkok';

function day(open: Array<[string, string]>, breaks: Array<[string, string]> = []): DaySchedule {
  return {
    open: open.map(([start, end]) => ({ start, end })),
    breaks: breaks.map(([start, end]) => ({ start, end })),
  };
}

function scheduleFor(overrides: Partial<Record<WeekdayKey, DaySchedule>>, holidays: string[] = []): FacilitySchedule {
  const days: Record<WeekdayKey, DaySchedule> = {
    '0': day([]),
    '1': day([]),
    '2': day([]),
    '3': day([]),
    '4': day([]),
    '5': day([]),
    '6': day([]),
  };
  for (const [key, value] of Object.entries(overrides) as Array<[WeekdayKey, DaySchedule]>) {
    days[key] = value;
  }
  return { days, holidays };
}

function isoList(slots: Array<{ startsAt: Date; endsAt: Date }>): string[] {
  return slots.map((slot) => `${slot.startsAt.toISOString()}..${slot.endsAt.toISOString()}`);
}

describe('UT-FB-01 slots from opening schedule, breaks, holidays, closures, future config', () => {
  it('generates fixed slots within a single opening window', () => {
    const schedule = scheduleFor({ '3': day([['09:00', '12:00']]) });
    const slots = generateSlotsForDate({
      schedule,
      slotMinutes: 60,
      date: '2026-10-14',
      timeZone: TIME_ZONE,
    });
    expect(isoList(slots)).toEqual([
      '2026-10-14T02:00:00.000Z..2026-10-14T03:00:00.000Z',
      '2026-10-14T03:00:00.000Z..2026-10-14T04:00:00.000Z',
      '2026-10-14T04:00:00.000Z..2026-10-14T05:00:00.000Z',
    ]);
  });

  it('emits only slots that fit fully inside the window', () => {
    const schedule = scheduleFor({ '3': day([['09:00', '10:30']]) });
    const slots = generateSlotsForDate({
      schedule,
      slotMinutes: 60,
      date: '2026-10-14',
      timeZone: TIME_ZONE,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-10-14T02:00:00.000Z');
    expect(slots[0]?.endsAt.toISOString()).toBe('2026-10-14T03:00:00.000Z');
  });

  it('skips slots overlapping a midday break but keeps the boundary slots', () => {
    const schedule = scheduleFor({ '3': day([['09:00', '12:00']], [['10:00', '11:00']]) });
    const slots = generateSlotsForDate({
      schedule,
      slotMinutes: 60,
      date: '2026-10-14',
      timeZone: TIME_ZONE,
    });
    expect(isoList(slots)).toEqual([
      '2026-10-14T02:00:00.000Z..2026-10-14T03:00:00.000Z',
      '2026-10-14T04:00:00.000Z..2026-10-14T05:00:00.000Z',
    ]);
  });

  it('returns no slots on a holiday', () => {
    const schedule = scheduleFor({ '3': day([['09:00', '12:00']]) }, ['2026-10-14']);
    const slots = generateSlotsForDate({
      schedule,
      slotMinutes: 60,
      date: '2026-10-14',
      timeZone: TIME_ZONE,
    });
    expect(slots).toEqual([]);
  });

  it('returns no slots on a closed weekday', () => {
    const schedule = scheduleFor({ '3': day([['09:00', '12:00']]) });
    const slots = generateSlotsForDate({
      schedule,
      slotMinutes: 60,
      date: '2026-10-15',
      timeZone: TIME_ZONE,
    });
    expect(slots).toEqual([]);
  });

  it('excludes slots overlapping a closure while keeping untouched slots', () => {
    const schedule = scheduleFor({ '3': day([['09:00', '12:00']]) });
    const slots = generateSlotsForDate({
      schedule,
      slotMinutes: 60,
      date: '2026-10-14',
      closures: [
        { startsAt: new Date('2026-10-14T03:30:00.000Z'), endsAt: new Date('2026-10-14T04:30:00.000Z') },
      ],
      timeZone: TIME_ZONE,
    });
    expect(isoList(slots)).toEqual(['2026-10-14T02:00:00.000Z..2026-10-14T03:00:00.000Z']);
  });

  it('keeps a slot that touches but does not overlap a closure boundary', () => {
    const schedule = scheduleFor({ '3': day([['09:00', '12:00']]) });
    const slots = generateSlotsForDate({
      schedule,
      slotMinutes: 60,
      date: '2026-10-14',
      closures: [
        { startsAt: new Date('2026-10-14T03:00:00.000Z'), endsAt: new Date('2026-10-14T04:00:00.000Z') },
      ],
      timeZone: TIME_ZONE,
    });
    expect(isoList(slots)).toEqual([
      '2026-10-14T02:00:00.000Z..2026-10-14T03:00:00.000Z',
      '2026-10-14T04:00:00.000Z..2026-10-14T05:00:00.000Z',
    ]);
  });

  it('selects the latest effective config at the query instant', () => {
    const configs = [
      { id: 'old', effectiveAt: new Date('2026-10-01T00:00:00.000Z') },
      { id: 'current', effectiveAt: new Date('2026-10-10T00:00:00.000Z') },
      { id: 'future', effectiveAt: new Date('2026-11-01T00:00:00.000Z') },
    ];
    expect(selectEffectiveConfig(configs, new Date('2026-10-14T00:00:00.000Z'))?.id).toBe('current');
    expect(selectEffectiveConfig(configs, new Date('2026-11-02T00:00:00.000Z'))?.id).toBe('future');
    expect(selectEffectiveConfig(configs, new Date('2026-09-01T00:00:00.000Z'))).toBeNull();
  });

  it('rejects overlapping openings, stray breaks, and bad inputs', () => {
    const overlapping = scheduleFor({ '3': day([['09:00', '11:00'], ['10:00', '12:00']]) });
    expect(() =>
      generateSlotsForDate({ schedule: overlapping, slotMinutes: 60, date: '2026-10-14' }),
    ).toThrowError();
    const strayBreak = scheduleFor({ '3': day([['09:00', '10:00']], [['10:00', '11:00']]) });
    expect(() =>
      generateSlotsForDate({ schedule: strayBreak, slotMinutes: 60, date: '2026-10-14' }),
    ).toThrowError();
    const valid = scheduleFor({ '3': day([['09:00', '12:00']]) });
    expect(() =>
      generateSlotsForDate({ schedule: valid, slotMinutes: 0, date: '2026-10-14' }),
    ).toThrowError();
    expect(() =>
      generateSlotsForDate({ schedule: valid, slotMinutes: 60, date: '2026-13-40' }),
    ).toThrowError();
  });
});

describe('UT-FB-06 capacity default and no cross-day slots', () => {
  it('defaults capacity to 1 and rejects non-positive values', () => {
    expect(resolveSlotCapacity(undefined)).toBe(1);
    expect(resolveSlotCapacity(null)).toBe(1);
    expect(resolveSlotCapacity(4)).toBe(4);
    expect(() => resolveSlotCapacity(0)).toThrowError();
    expect(() => resolveSlotCapacity(-2)).toThrowError();
  });

  it('never generates a slot crossing the local day boundary', () => {
    const schedule = scheduleFor({ '3': day([['23:00', '24:00']]) });
    const slots = generateSlotsForDate({
      schedule,
      slotMinutes: 60,
      date: '2026-10-14',
      timeZone: TIME_ZONE,
    });
    expect(isoList(slots)).toEqual(['2026-10-14T16:00:00.000Z..2026-10-14T17:00:00.000Z']);
    const overflowing = scheduleFor({ '3': day([['23:30', '24:00']]) });
    expect(
      generateSlotsForDate({
        schedule: overflowing,
        slotMinutes: 60,
        date: '2026-10-14',
        timeZone: TIME_ZONE,
      }),
    ).toEqual([]);
  });
});
