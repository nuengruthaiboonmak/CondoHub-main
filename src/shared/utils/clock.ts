import { PROJECT_TIMEZONE } from '../../config/project';
import { AppError } from './errors';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export type QuotaKind = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ProjectDateParts {
  year: number;
  month: number;
  day: number;
}

export function resolveTimeZone(timeZone?: string): string {
  return timeZone ?? PROJECT_TIMEZONE;
}

function assertValidInstant(at: Date): void {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new AppError('VALIDATION_ERROR', 'The timestamp is invalid.');
  }
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  dateFormatters.set(timeZone, formatter);
  return formatter;
}

function weekdayFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = weekdayFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
  weekdayFormatters.set(timeZone, formatter);
  return formatter;
}

export function projectDateParts(at: Date, timeZone?: string): ProjectDateParts {
  assertValidInstant(at);
  const zone = resolveTimeZone(timeZone);
  const formatted = dateFormatter(zone).format(at);
  const [year, month, day] = formatted.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new AppError('VALIDATION_ERROR', 'The project date parts are invalid.');
  }
  return { year, month, day };
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function projectWeekday(at: Date, timeZone?: string): number {
  assertValidInstant(at);
  const zone = resolveTimeZone(timeZone);
  const label = weekdayFormatter(zone).format(at);
  return WEEKDAY_SHORT.indexOf(label);
}

export function formatProjectDate(parts: ProjectDateParts): string {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('VALIDATION_ERROR', 'The month must be between 1 and 12.');
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function clampDayOfMonth(year: number, month: number, day: number): number {
  if (!Number.isInteger(day) || day < 1) {
    throw new AppError('VALIDATION_ERROR', 'The day of month must be a positive integer.');
  }
  return Math.min(day, daysInMonth(year, month));
}

export function dueDateForMonth(year: number, month: number, dueDay: number): string {
  return formatProjectDate({ year, month, day: clampDayOfMonth(year, month, dueDay) });
}

function weeksInIsoYear(year: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  if (jan1 === 4) return 53;
  if (jan1 === 3 && isLeapYear(year)) return 53;
  return 52;
}

export interface IsoWeekParts {
  isoYear: number;
  isoWeek: number;
}

export function isoWeekParts(year: number, month: number, day: number): IsoWeekParts {
  const weekdaySun0 = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekdayMon0 = (weekdaySun0 + 6) % 7;
  const ordinal = Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000,
  ) + 1;
  let week = Math.floor((ordinal - weekdayMon0 + 9) / 7);
  if (week < 1) {
    const isoYear = year - 1;
    return { isoYear, isoWeek: weeksInIsoYear(isoYear) };
  }
  const weeksThisYear = weeksInIsoYear(year);
  if (week > weeksThisYear) {
    return { isoYear: year + 1, isoWeek: 1 };
  }
  return { isoYear: year, isoWeek: week };
}

export function toPeriodKey(at: Date, kind: QuotaKind, timeZone?: string): string {
  const parts = projectDateParts(at, timeZone);
  if (kind === 'DAILY') return `${formatProjectDate(parts)}:D`;
  if (kind === 'MONTHLY') {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}:M`;
  }
  const { isoYear, isoWeek } = isoWeekParts(parts.year, parts.month, parts.day);
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}:W`;
}

export function offsetMsAt(utcMs: number, timeZone?: string): number {
  const zone = resolveTimeZone(timeZone);
  const formatted = dateFormatter(zone).format(new Date(utcMs));
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const [year, month, day] = formatted.split('-').map(Number);
  const [hour, minute, second] = timeFormatter.format(new Date(utcMs)).split(':').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    throw new AppError('VALIDATION_ERROR', 'The timezone offset parts are invalid.');
  }
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - utcMs;
}

export function cycleStartOfMonth(year: number, month: number, timeZone?: string): Date {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('VALIDATION_ERROR', 'The cycle month is invalid.');
  }
  const midnightUtc = Date.UTC(year, month - 1, 1);
  const firstPass = midnightUtc - offsetMsAt(midnightUtc + 43_200_000, timeZone);
  const secondPass = midnightUtc - offsetMsAt(firstPass, timeZone);
  return new Date(secondPass);
}
