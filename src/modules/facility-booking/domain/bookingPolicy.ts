import { AppError } from '@/shared/utils/errors';
import type { Actor } from '@/shared/auth/actor';
import { offsetMsAt } from '@/shared/utils/clock';
import {
  projectLocalDateString,
  projectLocalMinutes,
  shiftProjectDate,
} from './schedule';
import type { FacilitySchedule } from './schedule';

export type BookingSlotState = 'CONFIRMED' | 'RESIDENT_CANCELLED' | 'ADMIN_CANCELLED';

export type BookingDenyReason = 'ACCOUNT_SUSPENDED' | 'FIRST_LOGIN_REQUIRED' | 'NOT_RESIDENT';

export interface BookingVerdict {
  allowed: boolean;
  reason?: BookingDenyReason | undefined;
}

export function canBookFacility(
  actor: Actor,
  isActiveResident: boolean,
): BookingVerdict {
  if (actor.accountStatus !== 'ACTIVE') return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
  if (actor.mustChangePassword) return { allowed: false, reason: 'FIRST_LOGIN_REQUIRED' };
  if (!isActiveResident && !actor.isSystemAdmin) {
    return { allowed: false, reason: 'NOT_RESIDENT' };
  }
  return { allowed: true };
}

export function assertResidentCancelAllowed(slotStartsAt: Date, now: Date): void {
  if (now.getTime() >= slotStartsAt.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'Only future slots can be cancelled by residents.');
  }
}

export function assertSlotStartsInFuture(startsAt: Date, now: Date): void {
  if (startsAt.getTime() <= now.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'Slots must start in the future.');
  }
}

export function nextCancelState(isAdmin: boolean): BookingSlotState {
  return isAdmin ? 'ADMIN_CANCELLED' : 'RESIDENT_CANCELLED';
}

export function timeToMinutes(value: string): number {
  const [hourText, minuteText] = value.split(':') as [string, string];
  return Number(hourText) * 60 + Number(minuteText);
}

export interface SlotFitsScheduleInput {
  schedule: FacilitySchedule;
  startsAt: Date;
  endsAt: Date;
  timeZone?: string | undefined;
}

export function slotFitsSchedule(input: SlotFitsScheduleInput): boolean {
  if (input.endsAt.getTime() <= input.startsAt.getTime()) return false;
  const startDate = projectLocalDateString(input.startsAt, input.timeZone);
  let endMin = projectLocalMinutes(input.endsAt, input.timeZone);
  let endDate = projectLocalDateString(input.endsAt, input.timeZone);
  if (endMin === 0) {
    const shiftedMs =
      input.endsAt.getTime() + offsetMsAt(input.endsAt.getTime(), input.timeZone);
    if (shiftedMs % 60000 !== 0) return false;
    endMin = 1440;
    endDate = shiftProjectDate(endDate, -1);
  }
  if (startDate !== endDate) return false;
  if (input.schedule.holidays.includes(startDate)) return false;
  const weekday = String(
    new Date(Date.UTC(
      Number(startDate.slice(0, 4)),
      Number(startDate.slice(5, 7)) - 1,
      Number(startDate.slice(8, 10)),
    )).getUTCDay(),
  ) as '0' | '1' | '2' | '3' | '4' | '5' | '6';
  const daySchedule = input.schedule.days[weekday];
  const startMin = projectLocalMinutes(input.startsAt, input.timeZone);
  if (endMin <= startMin) return false;
  const insideOpen = daySchedule.open.some(
    (window) => startMin >= timeToMinutes(window.start) && endMin <= timeToMinutes(window.end),
  );
  if (!insideOpen) return false;
  const hitsBreak = daySchedule.breaks.some(
    (pause) => startMin < timeToMinutes(pause.end) && timeToMinutes(pause.start) < endMin,
  );
  return !hitsBreak;
}

export function overlaps(
  left: { startsAt: Date; endsAt: Date },
  right: { startsAt: Date; endsAt: Date },
): boolean {
  return left.startsAt.getTime() < right.endsAt.getTime() && right.startsAt.getTime() < left.endsAt.getTime();
}
