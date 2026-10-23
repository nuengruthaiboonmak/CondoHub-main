import { describe, expect, it } from 'vitest';
import {
  currentYearMonth,
  eventMidnight,
  eventServiceRange,
  isBillingCursorBehind,
  parseCycleRangeEnd,
  parseYearMonth,
  resolveGenerationWindow,
} from './billingWindow';

describe('generation window', () => {
  it('generates the current cycle when no cursor exists', () => {
    expect(resolveGenerationWindow({ currentYm: '2026-10', lastDoneCycle: null })).toEqual({
      cycles: ['2026-10'],
      businessKey: '2026-10',
      caughtUp: true,
    });
  });

  it('backfills from the cycle after the cursor', () => {
    expect(resolveGenerationWindow({ currentYm: '2026-10', lastDoneCycle: '2026-08' })).toEqual({
      cycles: ['2026-09', '2026-10'],
      businessKey: '2026-09:2026-10',
      caughtUp: true,
    });
  });

  it('caps backfill at three months with a continuation cursor', () => {
    expect(resolveGenerationWindow({ currentYm: '2026-10', lastDoneCycle: '2026-05' })).toEqual({
      cycles: ['2026-06', '2026-07', '2026-08'],
      businessKey: '2026-06:2026-08',
      caughtUp: false,
      nextFromCycle: '2026-09',
    });
  });

  it('honors explicit cycle ranges with the same cap', () => {
    expect(
      resolveGenerationWindow({ currentYm: '2026-10', fromCycle: '2026-01', toCycle: '2026-08' }),
    ).toEqual({
      cycles: ['2026-01', '2026-02', '2026-03'],
      businessKey: '2026-01:2026-03',
      caughtUp: false,
      nextFromCycle: '2026-04',
    });
  });

  it('treats a single explicit cycle as one business key', () => {
    expect(resolveGenerationWindow({ currentYm: '2026-10', fromCycle: '2026-07' })).toEqual({
      cycles: ['2026-07'],
      businessKey: '2026-07',
      caughtUp: true,
    });
  });

  it('rejects inverted ranges and malformed months', () => {
    expect(() =>
      resolveGenerationWindow({ currentYm: '2026-10', fromCycle: '2026-09', toCycle: '2026-08' }),
    ).toThrowError();
    expect(() => parseYearMonth('2026-13')).toThrowError();
    expect(() => parseYearMonth('october')).toThrowError();
  });

  it('detects a behind billing cursor', () => {
    expect(isBillingCursorBehind('2026-10', null)).toBe(true);
    expect(isBillingCursorBehind('2026-10', '2026-09')).toBe(true);
    expect(isBillingCursorBehind('2026-10', '2026-10')).toBe(false);
  });

  it('parses the range end from a business key', () => {
    expect(parseCycleRangeEnd('2026-10')).toBe('2026-10');
    expect(parseCycleRangeEnd('2026-08:2026-10')).toBe('2026-10');
    expect(() => parseCycleRangeEnd('bad')).toThrowError();
  });

  it('derives the current project year-month', () => {
    expect(currentYearMonth(new Date('2026-10-16T00:30:00.000Z'), 'Asia/Bangkok')).toBe('2026-10');
  });
});

describe('UT-BL-03A event boundaries', () => {
  it('uses 00:00 project time on the event date', () => {
    const midnight = eventMidnight('2026-10-10', 'Asia/Bangkok');
    expect(midnight.toISOString()).toBe('2026-10-09T17:00:00.000Z');
  });

  it('builds a one-day exclusive service range', () => {
    const range = eventServiceRange('2026-10-10', 'Asia/Bangkok');
    expect(range.periodEnd).toBe('2026-10-11');
    expect(range.serviceStart.toISOString()).toBe('2026-10-09T17:00:00.000Z');
    expect(range.serviceEndExclusive.toISOString()).toBe('2026-10-10T17:00:00.000Z');
  });

  it('rolls month boundaries correctly', () => {
    const range = eventServiceRange('2026-10-31', 'Asia/Bangkok');
    expect(range.periodEnd).toBe('2026-11-01');
  });

  it('rejects nonexistent calendar dates', () => {
    expect(() => eventMidnight('2026-02-30', 'Asia/Bangkok')).toThrowError();
    expect(() => eventServiceRange('2026-13-01', 'Asia/Bangkok')).toThrowError();
  });
});
