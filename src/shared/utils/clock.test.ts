import { describe, expect, it } from 'vitest';
import {
  cycleStartOfMonth,
  daysInMonth,
  dueDateForMonth,
  isoWeekParts,
  projectDateParts,
  projectWeekday,
  toPeriodKey,
} from './clock';

const BANGKOK = 'Asia/Bangkok';

describe('UT-SH-01 clock and periodKey', () => {
  it('derives project-local calendar parts across the UTC boundary', () => {
    expect(projectDateParts(new Date('2026-10-13T17:30:00.000Z'), BANGKOK)).toEqual({
      year: 2026,
      month: 10,
      day: 14,
    });
    expect(projectDateParts(new Date('2026-10-13T16:30:00.000Z'), BANGKOK)).toEqual({
      year: 2026,
      month: 10,
      day: 13,
    });
  });

  it('resolves weekday numbers Sunday-first in project time', () => {
    expect(projectWeekday(new Date('2026-10-14T00:00:00.000Z'), BANGKOK)).toBe(3);
    expect(projectWeekday(new Date('2026-10-18T00:00:00.000Z'), BANGKOK)).toBe(0);
  });

  it('clamps Feb dueDay 31 in common and leap years', () => {
    expect(dueDateForMonth(2026, 2, 31)).toBe('2026-02-28');
    expect(dueDateForMonth(2024, 2, 31)).toBe('2024-02-29');
    expect(dueDateForMonth(2026, 4, 31)).toBe('2026-04-30');
    expect(dueDateForMonth(2026, 1, 31)).toBe('2026-01-31');
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('computes ISO week parts with week-numbering-year edges', () => {
    expect(isoWeekParts(2023, 1, 1)).toEqual({ isoYear: 2022, isoWeek: 52 });
    expect(isoWeekParts(2024, 1, 1)).toEqual({ isoYear: 2024, isoWeek: 1 });
    expect(isoWeekParts(2020, 12, 31)).toEqual({ isoYear: 2020, isoWeek: 53 });
    expect(isoWeekParts(2021, 1, 1)).toEqual({ isoYear: 2020, isoWeek: 53 });
    expect(isoWeekParts(2026, 10, 14)).toEqual({ isoYear: 2026, isoWeek: 42 });
  });

  it('builds daily, weekly, and monthly period keys in project time', () => {
    expect(toPeriodKey(new Date('2026-10-13T17:30:00.000Z'), 'DAILY', BANGKOK)).toBe(
      '2026-10-14:D',
    );
    expect(toPeriodKey(new Date('2026-10-13T17:30:00.000Z'), 'MONTHLY', BANGKOK)).toBe(
      '2026-10:M',
    );
    expect(toPeriodKey(new Date('2026-10-13T17:30:00.000Z'), 'WEEKLY', BANGKOK)).toBe(
      '2026-W42:W',
    );
    expect(toPeriodKey(new Date('2022-12-31T17:00:00.000Z'), 'WEEKLY', BANGKOK)).toBe(
      '2022-W52:W',
    );
  });

  it('keeps Monday 00:00 local inside the same weekly period', () => {
    const mondayStart = new Date('2026-10-11T17:00:00.000Z');
    const mondayNoon = new Date('2026-10-12T05:00:00.000Z');
    const beforeMidnight = new Date('2026-10-11T16:59:59.999Z');
    expect(toPeriodKey(mondayStart, 'WEEKLY', BANGKOK)).toBe('2026-W42:W');
    expect(toPeriodKey(mondayNoon, 'WEEKLY', BANGKOK)).toBe('2026-W42:W');
    expect(toPeriodKey(beforeMidnight, 'WEEKLY', BANGKOK)).toBe('2026-W41:W');
  });

  it('computes cycle start as month-day-1 midnight project time', () => {
    expect(cycleStartOfMonth(2026, 10, BANGKOK).toISOString()).toBe(
      '2026-09-30T17:00:00.000Z',
    );
    expect(cycleStartOfMonth(2024, 2, BANGKOK).toISOString()).toBe(
      '2024-01-31T17:00:00.000Z',
    );
  });

  it('rejects invalid instants and calendar inputs', () => {
    expect(() => projectDateParts(new Date('invalid'), BANGKOK)).toThrowError();
    expect(() => daysInMonth(2026, 13)).toThrowError();
    expect(() => dueDateForMonth(2026, 2, 0)).toThrowError();
    expect(() => cycleStartOfMonth(2026, 0, BANGKOK)).toThrowError();
  });
});
