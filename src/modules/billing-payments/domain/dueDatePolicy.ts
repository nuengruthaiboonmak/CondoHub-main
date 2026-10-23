import { AppError } from '@/shared/utils/errors';
import { dueDateForMonth } from '@/shared/utils/clock';

export const DEFAULT_RENT_DUE_DAY = 5;

export function assertValidDueDay(dueDay: number): void {
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new AppError('VALIDATION_ERROR', 'The due day must be between 1 and 31.');
  }
}

export function rentDueDateForCycle(
  year: number,
  month: number,
  dueDay: number = DEFAULT_RENT_DUE_DAY,
): string {
  assertValidDueDay(dueDay);
  return dueDateForMonth(year, month, dueDay);
}

export function recurringFeeDueDateForCycle(
  year: number,
  month: number,
  dueDay: number = DEFAULT_RENT_DUE_DAY,
): string {
  return rentDueDateForCycle(year, month, dueDay);
}

export function oneTimeFeeDueDate(eventEffectiveDate: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(eventEffectiveDate)) {
    throw new AppError('VALIDATION_ERROR', 'The event effective date is invalid.');
  }
  return eventEffectiveDate;
}
