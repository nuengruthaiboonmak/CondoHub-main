import { AppError } from '@/shared/utils/errors';
import {
  daysInMonth,
  formatProjectDate,
  offsetMsAt,
  resolveTimeZone,
} from '@/shared/utils/clock';

export const GENERATE_BACKFILL_MAX_MONTHS = 3;

const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const CALENDAR_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface YearMonth {
  year: number;
  month: number;
}

export function parseYearMonth(value: string): YearMonth {
  if (!YEAR_MONTH_REGEX.test(value)) {
    throw new AppError('VALIDATION_ERROR', 'The cycle month must use YYYY-MM format.');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return { year, month };
}

export function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function addMonthsToYearMonth(year: number, month: number, count: number): YearMonth {
  const total = year * 12 + (month - 1) + count;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function compareYearMonth(a: YearMonth, b: YearMonth): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  return 0;
}

function monthsBetweenInclusive(start: YearMonth, end: YearMonth): number {
  return (end.year - start.year) * 12 + (end.month - start.month) + 1;
}

export interface GenerationWindow {
  cycles: string[];
  businessKey: string;
  caughtUp: boolean;
  nextFromCycle?: string | undefined;
}

export function resolveGenerationWindow(input: {
  currentYm: string;
  fromCycle?: string | undefined;
  toCycle?: string | undefined;
  lastDoneCycle?: string | null | undefined;
}): GenerationWindow {
  const current = parseYearMonth(input.currentYm);
  let start: YearMonth;
  let end: YearMonth;
  if (input.fromCycle === undefined && input.toCycle === undefined) {
    end = current;
    if (input.lastDoneCycle === undefined || input.lastDoneCycle === null) {
      start = current;
    } else {
      const after = addMonthsToYearMonth(
        parseYearMonth(input.lastDoneCycle).year,
        parseYearMonth(input.lastDoneCycle).month,
        1,
      );
      start = compareYearMonth(after, current) > 0 ? current : after;
    }
  } else if (input.fromCycle !== undefined && input.toCycle === undefined) {
    start = parseYearMonth(input.fromCycle);
    end = start;
  } else if (input.fromCycle === undefined && input.toCycle !== undefined) {
    start = parseYearMonth(input.toCycle);
    end = start;
  } else {
    start = parseYearMonth(input.fromCycle as string);
    end = parseYearMonth(input.toCycle as string);
  }
  if (compareYearMonth(start, end) > 0) {
    throw new AppError('VALIDATION_ERROR', 'The fromCycle must not be after toCycle.');
  }
  const total = monthsBetweenInclusive(start, end);
  const take = Math.min(total, GENERATE_BACKFILL_MAX_MONTHS);
  const cycles: string[] = [];
  for (let offset = 0; offset < take; offset += 1) {
    const cursor = addMonthsToYearMonth(start.year, start.month, offset);
    cycles.push(formatYearMonth(cursor.year, cursor.month));
  }
  const first = cycles[0];
  const last = cycles[cycles.length - 1];
  if (first === undefined || last === undefined) {
    throw new AppError('VALIDATION_ERROR', 'The generation window is empty.');
  }
  const window: GenerationWindow = {
    cycles,
    businessKey: cycles.length === 1 ? first : `${first}:${last}`,
    caughtUp: total <= GENERATE_BACKFILL_MAX_MONTHS,
  };
  if (total > GENERATE_BACKFILL_MAX_MONTHS) {
    const next = addMonthsToYearMonth(start.year, start.month, GENERATE_BACKFILL_MAX_MONTHS);
    window.nextFromCycle = formatYearMonth(next.year, next.month);
  }
  return window;
}

export function isBillingCursorBehind(
  currentYm: string,
  lastDoneEndYm: string | null,
): boolean {
  const current = parseYearMonth(currentYm);
  if (lastDoneEndYm === null) return true;
  return compareYearMonth(parseYearMonth(lastDoneEndYm), current) < 0;
}

export function parseCycleRangeEnd(businessKey: string): string {
  const parts = businessKey.split(':');
  if (parts.length === 1) {
    parseYearMonth(parts[0] as string);
    return parts[0] as string;
  }
  if (parts.length === 2) {
    parseYearMonth(parts[0] as string);
    parseYearMonth(parts[1] as string);
    return parts[1] as string;
  }
  throw new AppError('VALIDATION_ERROR', 'The business key is invalid.');
}

export function currentYearMonth(now: Date, timeZone?: string): string {
  const zone = resolveTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
  });
  const [year, month] = formatter.format(now).split('-').map(Number);
  if (year === undefined || month === undefined) {
    throw new AppError('VALIDATION_ERROR', 'The project year-month parts are invalid.');
  }
  return formatYearMonth(year, month);
}

export interface ProjectCalendarDate {
  year: number;
  month: number;
  day: number;
}

export function parseCalendarDate(value: string): ProjectCalendarDate {
  if (!CALENDAR_DATE_REGEX.test(value)) {
    throw new AppError('VALIDATION_ERROR', 'The date must use YYYY-MM-DD format.');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (day > daysInMonth(year, month)) {
    throw new AppError('VALIDATION_ERROR', 'The calendar date does not exist.');
  }
  return { year, month, day };
}

export function eventMidnight(eventDate: string, timeZone?: string): Date {
  const parts = parseCalendarDate(eventDate);
  const midnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const firstPass = midnightUtc - offsetMsAt(midnightUtc + 43_200_000, timeZone);
  const secondPass = midnightUtc - offsetMsAt(firstPass, timeZone);
  return new Date(secondPass);
}

export interface EventServiceRange {
  serviceStart: Date;
  serviceEndExclusive: Date;
  periodEnd: string;
}

export function eventServiceRange(eventDate: string, timeZone?: string): EventServiceRange {
  const parts = parseCalendarDate(eventDate);
  const nextUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const periodEnd = formatProjectDate({
    year: nextUtc.getUTCFullYear(),
    month: nextUtc.getUTCMonth() + 1,
    day: nextUtc.getUTCDate(),
  });
  const serviceStart = eventMidnight(eventDate, timeZone);
  const serviceEndExclusive = eventMidnight(periodEnd, timeZone);
  return { serviceStart, serviceEndExclusive, periodEnd };
}
