import { AppError } from '@/shared/utils/errors';
import { cycleStartOfMonth, formatProjectDate } from '@/shared/utils/clock';

export type CommonFeeFrequency =
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'HALF_YEARLY'
  | 'YEARLY'
  | 'ONE_TIME';

export interface BillingCycle {
  cycleStart: Date;
  cycleEndExclusive: Date;
  periodStart: string;
  periodEnd: string;
  serviceStart: Date;
  serviceEndExclusive: Date;
}

function assertValidYearMonth(year: number, month: number): void {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('VALIDATION_ERROR', 'The cycle month is invalid.');
  }
}

export function cycleStartMonthFor(
  frequency: CommonFeeFrequency,
  year: number,
  month: number,
): { year: number; month: number } {
  assertValidYearMonth(year, month);
  if (frequency === 'MONTHLY') return { year, month };
  if (frequency === 'QUARTERLY') {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return { year, month: startMonth };
  }
  if (frequency === 'HALF_YEARLY') {
    const startMonth = month <= 6 ? 1 : 7;
    return { year, month: startMonth };
  }
  if (frequency === 'YEARLY') return { year, month: 1 };
  throw new AppError('VALIDATION_ERROR', 'One-time charges have no recurring cycle.');
}

export function isCycleStartMonth(
  frequency: CommonFeeFrequency,
  year: number,
  month: number,
): boolean {
  if (frequency === 'ONE_TIME') return false;
  const start = cycleStartMonthFor(frequency, year, month);
  return start.year === year && start.month === month;
}

function addMonths(year: number, month: number, count: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + count;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function cycleLengthMonths(frequency: CommonFeeFrequency): number {
  if (frequency === 'MONTHLY') return 1;
  if (frequency === 'QUARTERLY') return 3;
  if (frequency === 'HALF_YEARLY') return 6;
  if (frequency === 'YEARLY') return 12;
  throw new AppError('VALIDATION_ERROR', 'One-time charges have no recurring cycle.');
}

export function cycleForMonth(
  frequency: CommonFeeFrequency,
  year: number,
  month: number,
  timeZone?: string,
): BillingCycle {
  const start = cycleStartMonthFor(frequency, year, month);
  const end = addMonths(start.year, start.month, cycleLengthMonths(frequency));
  const cycleStart = cycleStartOfMonth(start.year, start.month, timeZone);
  const cycleEndExclusive = cycleStartOfMonth(end.year, end.month, timeZone);
  return {
    cycleStart,
    cycleEndExclusive,
    periodStart: formatProjectDate({ year: start.year, month: start.month, day: 1 }),
    periodEnd: formatProjectDate({ year: end.year, month: end.month, day: 1 }),
    serviceStart: cycleStart,
    serviceEndExclusive: cycleEndExclusive,
  };
}

export function rentMonthCycle(year: number, month: number, timeZone?: string): BillingCycle {
  return cycleForMonth('MONTHLY', year, month, timeZone);
}

export function monthBounds(year: number, month: number, timeZone?: string): {
  start: Date;
  end: Date;
} {
  const cycle = rentMonthCycle(year, month, timeZone);
  return { start: cycle.cycleStart, end: cycle.cycleEndExclusive };
}
