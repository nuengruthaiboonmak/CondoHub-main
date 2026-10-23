import { describe, expect, it } from 'vitest';
import {
  cycleForMonth,
  cycleStartMonthFor,
  isCycleStartMonth,
} from './billingCycle';

describe('UT-BL-03 cycle math per frequency', () => {
  it('maps monthly cycles to the same month', () => {
    expect(cycleStartMonthFor('MONTHLY', 2026, 10)).toEqual({ year: 2026, month: 10 });
    expect(isCycleStartMonth('MONTHLY', 2026, 10)).toBe(true);
    const cycle = cycleForMonth('MONTHLY', 2026, 10, 'Asia/Bangkok');
    expect(cycle.periodStart).toBe('2026-10-01');
    expect(cycle.periodEnd).toBe('2026-11-01');
  });

  it('maps quarterly cycles to calendar quarters', () => {
    expect(cycleStartMonthFor('QUARTERLY', 2026, 1)).toEqual({ year: 2026, month: 1 });
    expect(cycleStartMonthFor('QUARTERLY', 2026, 2)).toEqual({ year: 2026, month: 1 });
    expect(cycleStartMonthFor('QUARTERLY', 2026, 4)).toEqual({ year: 2026, month: 4 });
    expect(cycleStartMonthFor('QUARTERLY', 2026, 12)).toEqual({ year: 2026, month: 10 });
    expect(isCycleStartMonth('QUARTERLY', 2026, 1)).toBe(true);
    expect(isCycleStartMonth('QUARTERLY', 2026, 2)).toBe(false);
    const cycle = cycleForMonth('QUARTERLY', 2026, 5, 'Asia/Bangkok');
    expect(cycle.periodStart).toBe('2026-04-01');
    expect(cycle.periodEnd).toBe('2026-07-01');
  });

  it('maps half-yearly cycles to January and July', () => {
    expect(cycleStartMonthFor('HALF_YEARLY', 2026, 6)).toEqual({ year: 2026, month: 1 });
    expect(cycleStartMonthFor('HALF_YEARLY', 2026, 7)).toEqual({ year: 2026, month: 7 });
    expect(isCycleStartMonth('HALF_YEARLY', 2026, 1)).toBe(true);
    expect(isCycleStartMonth('HALF_YEARLY', 2026, 7)).toBe(true);
    expect(isCycleStartMonth('HALF_YEARLY', 2026, 8)).toBe(false);
    const cycle = cycleForMonth('HALF_YEARLY', 2026, 11, 'Asia/Bangkok');
    expect(cycle.periodStart).toBe('2026-07-01');
    expect(cycle.periodEnd).toBe('2027-01-01');
  });

  it('maps yearly cycles to January with a December rollover', () => {
    expect(cycleStartMonthFor('YEARLY', 2026, 12)).toEqual({ year: 2026, month: 1 });
    expect(isCycleStartMonth('YEARLY', 2026, 1)).toBe(true);
    expect(isCycleStartMonth('YEARLY', 2026, 6)).toBe(false);
    const cycle = cycleForMonth('YEARLY', 2026, 9, 'Asia/Bangkok');
    expect(cycle.periodStart).toBe('2026-01-01');
    expect(cycle.periodEnd).toBe('2027-01-01');
  });

  it('marks quarter and year boundaries consistently', () => {
    const quarter = cycleForMonth('QUARTERLY', 2026, 10, 'Asia/Bangkok');
    expect(quarter.periodStart).toBe('2026-10-01');
    expect(quarter.periodEnd).toBe('2027-01-01');
    expect(quarter.serviceStart.getTime()).toBeLessThan(quarter.serviceEndExclusive.getTime());
  });

  it('rejects one-time cycles', () => {
    expect(isCycleStartMonth('ONE_TIME', 2026, 10)).toBe(false);
    expect(() => cycleStartMonthFor('ONE_TIME', 2026, 10)).toThrowError();
    expect(() => cycleForMonth('ONE_TIME', 2026, 10)).toThrowError();
  });
});
