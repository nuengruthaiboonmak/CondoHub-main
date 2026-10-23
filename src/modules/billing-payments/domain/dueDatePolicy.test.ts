import { describe, expect, it } from 'vitest';
import {
  oneTimeFeeDueDate,
  recurringFeeDueDateForCycle,
  rentDueDateForCycle,
} from './dueDatePolicy';

describe('PD-04 due-day clamps to the last local calendar day', () => {
  it('keeps valid due days unchanged', () => {
    expect(rentDueDateForCycle(2026, 10, 5)).toBe('2026-10-05');
    expect(recurringFeeDueDateForCycle(2026, 1, 31)).toBe('2026-01-31');
  });

  it('clamps day 31 in short months', () => {
    expect(rentDueDateForCycle(2026, 4, 31)).toBe('2026-04-30');
    expect(rentDueDateForCycle(2026, 9, 31)).toBe('2026-09-30');
    expect(recurringFeeDueDateForCycle(2026, 11, 31)).toBe('2026-11-30');
  });

  it('clamps February in a common year', () => {
    expect(rentDueDateForCycle(2026, 2, 31)).toBe('2026-02-28');
    expect(rentDueDateForCycle(2026, 2, 29)).toBe('2026-02-28');
  });

  it('keeps Feb 29 in a leap year and clamps day 30', () => {
    expect(rentDueDateForCycle(2024, 2, 29)).toBe('2024-02-29');
    expect(rentDueDateForCycle(2024, 2, 30)).toBe('2024-02-29');
    expect(rentDueDateForCycle(2024, 2, 31)).toBe('2024-02-29');
  });

  it('uses the default due day when none is provided', () => {
    expect(rentDueDateForCycle(2026, 10)).toBe('2026-10-05');
    expect(recurringFeeDueDateForCycle(2026, 2)).toBe('2026-02-05');
  });

  it('rejects due days outside 1 to 31', () => {
    expect(() => rentDueDateForCycle(2026, 10, 0)).toThrowError();
    expect(() => rentDueDateForCycle(2026, 10, 32)).toThrowError();
  });

  it('keeps one-time due dates equal to the event effective date', () => {
    expect(oneTimeFeeDueDate('2026-10-10')).toBe('2026-10-10');
    expect(() => oneTimeFeeDueDate('2026-13-01')).toThrowError();
    expect(() => oneTimeFeeDueDate('not-a-date')).toThrowError();
  });
});
