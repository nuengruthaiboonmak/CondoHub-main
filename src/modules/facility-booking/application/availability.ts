import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { formatProjectDate, projectDateParts, toPeriodKey } from '@/shared/utils/clock';
import { canActInRoom } from '@/modules/property-membership/application/index';
import {
  assertValidSchedule,
  generateSlotsForDate,
  parseProjectDate,
  projectLocalDateString,
  resolveSlotCapacity,
  type ClosureWindow,
  type FacilitySchedule,
} from '../domain/schedule';
import { countQuotaUsed } from '../domain/quotaLedger';
import {
  findEffectiveConfig,
  findFacilityById,
  listAdjustmentsForRoomFacility,
  listClosuresOverlapping,
  listConfirmedSlotsInRange,
  listQuotaConsumingSlots,
  type FacilityConfigRecord,
} from '../infrastructure/facilityRepository';

function requireUsableActor(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

export interface SlotAvailabilityDto {
  startsAt: string;
  endsAt: string;
  confirmed: number;
  capacity: number;
  remaining: number;
  mine: number;
  available: boolean;
}

export interface DayAvailabilityDto {
  facilityId: string;
  date: string;
  roomId: string;
  quotaKind: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  quotaLimit: number;
  quotaUsed: number;
  periodKey: string;
  slots: SlotAvailabilityDto[];
}

function dayBoundsUtc(date: string): { rangeStart: Date; rangeEnd: Date } {
  const { year, month, day } = parseProjectDate(date);
  const rangeStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 14 * 3_600_000);
  const rangeEnd = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0) + 14 * 3_600_000);
  return { rangeStart, rangeEnd };
}

function addDaysToProjectDate(date: string, days: number): string {
  const { year, month, day } = parseProjectDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${shiftedMonth}-${shiftedDay}`;
}

export function assertWithinAdvanceWindow(
  config: FacilityConfigRecord,
  date: string,
  now: Date,
): void {
  const todayParts = projectDateParts(now);
  const today = formatProjectDate(todayParts);
  const latest = addDaysToProjectDate(today, config.advanceDays);
  if (date < today || date > latest) {
    throw new AppError('VALIDATION_ERROR', 'The date is outside the advance booking window.');
  }
}

async function resolveRoomQuota(
  roomId: string,
  facilityId: string,
  config: FacilityConfigRecord,
  date: string,
  at: Date,
): Promise<{ periodKey: string; used: number }> {
  const probe = new Date(at.getTime());
  const dateParts = parseProjectDate(date);
  const nowParts = projectDateParts(at);
  const sameDay =
    dateParts.year === nowParts.year &&
    dateParts.month === nowParts.month &&
    dateParts.day === nowParts.day;
  const reference = sameDay ? probe : new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 5, 0, 0));
  const periodKey = toPeriodKey(reference, config.quotaKind);
  const [slots, credits] = await Promise.all([
    listQuotaConsumingSlots(db, { roomId, facilityId }),
    listAdjustmentsForRoomFacility(db, { roomId, facilityId, periodKey }),
  ]);
  const used = countQuotaUsed({
    slots: slots.map((slot) => ({ id: slot.id, startsAt: slot.startsAt, state: slot.state })),
    credits: credits.map((credit) => ({
      bookingSlotId: credit.bookingSlotId,
      signedSlots: credit.signedSlots,
    })),
    periodKey,
    kind: config.quotaKind,
  });
  return { periodKey, used };
}

export async function getDayAvailability(
  actor: Actor,
  facilityId: string,
  input: { date: string; roomId: string },
  at: Date,
): Promise<DayAvailabilityDto> {
  requireUsableActor(actor);
  const facility = await findFacilityById(db, facilityId);
  if (facility === null) throw new AppError('RESOURCE_NOT_FOUND');
  const verdict = await canActInRoom(actor.userId, input.roomId, 'BOOK_FACILITY', at).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    },
  );
  if (verdict === null || (!verdict.allowed && !actor.isSystemAdmin)) {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  if (facility.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', 'The facility is not open for booking.');
  const config = await findEffectiveConfig(db, facilityId, at);
  if (config === null) {
    throw new AppError('VALIDATION_ERROR', 'The facility has no effective configuration.');
  }
  assertWithinAdvanceWindow(config, input.date, at);
  const schedule = config.scheduleJson as FacilitySchedule;
  assertValidSchedule(schedule);
  const { rangeStart, rangeEnd } = dayBoundsUtc(input.date);
  const closures = await listClosuresOverlapping(db, facilityId, rangeStart, rangeEnd);
  const closureWindows: ClosureWindow[] = closures.map((closure) => ({
    startsAt: closure.startsAt,
    endsAt: closure.endsAt,
  }));
  const generated = generateSlotsForDate({
    schedule,
    slotMinutes: config.slotMinutes,
    date: input.date,
    closures: closureWindows,
  });
  const confirmed = await listConfirmedSlotsInRange(db, {
    facilityId,
    rangeStart,
    rangeEnd,
  });
  const capacity = resolveSlotCapacity(facility.capacity);
  const slots: SlotAvailabilityDto[] = generated.map((slot) => {
    const slotDate = projectLocalDateString(slot.startsAt);
    if (slotDate !== input.date) return null;
    const matches = confirmed.filter(
      (row) =>
        row.startsAt.getTime() === slot.startsAt.getTime() &&
        row.endsAt.getTime() === slot.endsAt.getTime(),
    );
    const mine = matches.filter((row) => row.roomId === input.roomId).length;
    const remaining = Math.max(0, capacity - matches.length);
    return {
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      confirmed: matches.length,
      capacity,
      remaining,
      mine,
      available: remaining > 0 && slot.startsAt.getTime() > at.getTime(),
    };
  }).filter((slot): slot is SlotAvailabilityDto => slot !== null);
  const quota = await resolveRoomQuota(input.roomId, facilityId, config, input.date, at);
  return {
    facilityId,
    date: input.date,
    roomId: input.roomId,
    quotaKind: config.quotaKind,
    quotaLimit: config.quotaLimit,
    quotaUsed: quota.used,
    periodKey: quota.periodKey,
    slots,
  };
}

export async function getRoomQuota(
  actor: Actor,
  facilityId: string,
  input: { roomId: string; date?: string | undefined },
  at: Date,
): Promise<{
  facilityId: string;
  roomId: string;
  quotaKind: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  quotaLimit: number;
  quotaUsed: number;
  periodKey: string;
}> {
  requireUsableActor(actor);
  const facility = await findFacilityById(db, facilityId);
  if (facility === null) throw new AppError('RESOURCE_NOT_FOUND');
  const verdict = await canActInRoom(actor.userId, input.roomId, 'BOOK_FACILITY', at).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    },
  );
  if (verdict === null || (!verdict.allowed && !actor.isSystemAdmin)) {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  const config = await findEffectiveConfig(db, facilityId, at);
  if (config === null) {
    throw new AppError('VALIDATION_ERROR', 'The facility has no effective configuration.');
  }
  const parts = projectDateParts(at);
  const date = input.date ?? formatProjectDate(parts);
  parseProjectDate(date);
  const quota = await resolveRoomQuota(input.roomId, facilityId, config, date, at);
  return {
    facilityId,
    roomId: input.roomId,
    quotaKind: config.quotaKind,
    quotaLimit: config.quotaLimit,
    quotaUsed: quota.used,
    periodKey: quota.periodKey,
  };
}
