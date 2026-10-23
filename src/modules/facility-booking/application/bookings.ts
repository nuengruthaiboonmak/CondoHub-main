import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db, Tx } from '@/shared/db/transaction';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { hashRequestBody } from '@/shared/utils/idempotency';
import { toPeriodKey } from '@/shared/utils/clock';
import { writeAudit } from '@/shared/observability/audit';
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
import { countQuotaUsed, groupSlotsByPeriod } from '../domain/quotaLedger';
import {
  assertResidentCancelAllowed,
  assertSlotStartsInFuture,
  canBookFacility,
  nextCancelState,
  overlaps,
  slotFitsSchedule,
} from '../domain/bookingPolicy';
import {
  ensureQuotaPeriodLocks,
  findBookingById,
  findEffectiveConfig,
  findFacilityById,
  insertBooking,
  insertBookingSlots,
  insertRefundCredit,
  listAdjustmentsForRoomFacility,
  listBookingsForRoom,
  listBookingFacilityLabels,
  listClosuresOverlapping,
  listConfirmedSlotsInRange,
  listQuotaConsumingSlots,
  listSlotsForBooking,
  lockBookingSlotForUpdate,
  lockEffectiveConfigForUpdate,
  lockFacilityForUpdate,
  updateBookingSlotState,
  type FacilityConfigRecord,
} from '../infrastructure/facilityRepository';
import { assertWithinAdvanceWindow } from './availability';
import { getIdempotencyRecord, upsertIdempotencyRecord } from './idempotencyStore';
import type { BookingCtx } from './ctx';

function requireUsableActor(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

export interface BookingSlotDto {
  id: string;
  startsAt: string;
  endsAt: string;
  state: 'CONFIRMED' | 'RESIDENT_CANCELLED' | 'ADMIN_CANCELLED';
  refundQuota: boolean;
}

export interface BookingDto {
  id: string;
  roomId: string;
  facilityId: string;
  createdAt: string;
  slots: BookingSlotDto[];
}

async function toBookingDto(conn: Db, bookingId: string): Promise<BookingDto | null> {
  const booking = await findBookingById(conn, bookingId);
  if (booking === null) return null;
  const slots = await listSlotsForBooking(conn, bookingId);
  return {
    id: booking.id,
    roomId: booking.roomId,
    facilityId: booking.facilityId,
    createdAt: booking.createdAt.toISOString(),
    slots: slots.map((slot) => ({
      id: slot.id,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      state: slot.state,
      refundQuota: slot.refundQuota,
    })),
  };
}

function parseStarts(values: string[]): Date[] {
  return values.map((value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError('VALIDATION_ERROR', 'The requested slot time is invalid.');
    }
    return parsed;
  });
}

async function resolveClosuresForDates(
  conn: Db,
  facilityId: string,
  dates: string[],
): Promise<Map<string, ClosureWindow[]>> {
  const grouped = new Map<string, ClosureWindow[]>();
  for (const date of dates) {
    const { year, month, day } = parseProjectDate(date);
    const rangeStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 14 * 3_600_000);
    const rangeEnd = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0) + 14 * 3_600_000);
    const closures = await listClosuresOverlapping(conn, facilityId, rangeStart, rangeEnd);
    grouped.set(
      date,
      closures.map((closure) => ({ startsAt: closure.startsAt, endsAt: closure.endsAt })),
    );
  }
  return grouped;
}

function generatedStartsFor(
  schedule: FacilitySchedule,
  slotMinutes: number,
  date: string,
  closures: ClosureWindow[],
): Set<string> {
  const generated = generateSlotsForDate({ schedule, slotMinutes, date, closures });
  return new Set(generated.map((slot) => slot.startsAt.toISOString()));
}

export interface CreateBookingInput {
  facilityId: string;
  roomId: string;
  startsAt: string[];
  idempotencyKey?: string | undefined;
}

export async function createBooking(
  actor: Actor,
  input: CreateBookingInput,
  ctx: BookingCtx,
): Promise<BookingDto> {
  requireUsableActor(actor);
  if (input.startsAt.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'At least one slot is required.');
  }
  if (new Set(input.startsAt).size !== input.startsAt.length) {
    throw new AppError('VALIDATION_ERROR', 'The requested slots must be unique.');
  }
  const now = ctx.clock.now();
  const starts = parseStarts(input.startsAt);
  for (const start of starts) assertSlotStartsInFuture(start, now);
  const facility = await findFacilityById(db, input.facilityId);
  if (facility === null) throw new AppError('RESOURCE_NOT_FOUND');
  const verdict = await canActInRoom(actor.userId, input.roomId, 'BOOK_FACILITY', now).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    },
  );
  if (verdict === null) throw new AppError('RESOURCE_NOT_FOUND');
  const policy = canBookFacility(actor, verdict.allowed);
  if (!policy.allowed) {
    if (policy.reason === 'NOT_RESIDENT') throw new AppError('RESOURCE_NOT_FOUND');
    throw new AppError('ACCESS_DENIED');
  }
  if (facility.status !== 'ACTIVE') {
    throw new AppError('VALIDATION_ERROR', 'The facility is not open for booking.');
  }
  const requestHash = hashRequestBody({
    facilityId: input.facilityId,
    roomId: input.roomId,
    startsAt: [...input.startsAt].sort(),
  });
  if (input.idempotencyKey !== undefined) {
    const existing = await getIdempotencyRecord(db, {
      scope: 'BOOKING_CREATE',
      key: input.idempotencyKey,
    });
    if (existing !== null) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          'VALIDATION_ERROR',
          'The Idempotency-Key was already used with a different request.',
        );
      }
      if (existing.resultRefId !== null) {
        const replay = await toBookingDto(db, existing.resultRefId);
        if (replay !== null) return replay;
      }
      throw new AppError('RATE_LIMITED');
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const currentFacility = await lockFacilityForUpdate(tx, input.facilityId);
      if (!currentFacility) throw new AppError('RESOURCE_NOT_FOUND');
      if (currentFacility.status !== 'ACTIVE')
        throw new AppError('VALIDATION_ERROR', 'The facility is not open for booking.');
      const config = await lockEffectiveConfigForUpdate(tx, input.facilityId, now);
      if (config === null) {
        throw new AppError('VALIDATION_ERROR', 'The facility has no effective configuration.');
      }
      const schedule = config.scheduleJson as FacilitySchedule;
      assertValidSchedule(schedule);
      const dates = [...new Set(starts.map((start) => projectLocalDateString(start)))].sort();
      for (const date of dates) assertWithinAdvanceWindow(config, date, now);
      const closuresByDate = await resolveClosuresForDates(tx, input.facilityId, dates);
      const allowed = new Map<string, Set<string>>();
      for (const date of dates) {
        allowed.set(
          date,
          generatedStartsFor(schedule, config.slotMinutes, date, closuresByDate.get(date) ?? []),
        );
      }
      const ends = new Map<string, Date>();
      for (const start of starts) {
        const date = projectLocalDateString(start);
        const endsAt = new Date(start.getTime() + config.slotMinutes * 60_000);
        if (
          !slotFitsSchedule({ schedule, startsAt: start, endsAt }) ||
          !(allowed.get(date)?.has(start.toISOString()) ?? false)
        ) {
          throw new AppError('BOOKING_SLOT_UNAVAILABLE');
        }
        ends.set(start.toISOString(), endsAt);
      }
      const periodKeys = [...groupSlotsByPeriod(starts, config.quotaKind).keys()];
      await ensureQuotaPeriodLocks(tx, {
        roomId: input.roomId,
        facilityId: input.facilityId,
        periodKeys,
      });
      const capacity = resolveSlotCapacity(currentFacility.capacity);
      await assertCapacityAvailable(
        tx,
        input.facilityId,
        starts,
        ends,
        capacity,
        config.slotMinutes,
      );
      await assertQuotaAvailable(tx, input.roomId, input.facilityId, starts, config);
      const created = await insertBooking(tx, {
        roomId: input.roomId,
        facilityId: input.facilityId,
        createdBy: actor.userId,
      });
      await insertBookingSlots(
        tx,
        starts.map((start) => ({
          bookingId: created.id,
          facilityId: input.facilityId,
          roomId: input.roomId,
          startsAt: start,
          endsAt: ends.get(start.toISOString()) ?? start,
        })),
      );
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'booking.created',
        resourceType: 'booking',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: {
          facilityId: input.facilityId,
          roomId: input.roomId,
          slotCount: starts.length,
          periodKeys,
        },
      });
      if (input.idempotencyKey !== undefined) {
        await upsertIdempotencyRecord(tx, {
          scope: 'BOOKING_CREATE',
          key: input.idempotencyKey,
          actorId: actor.userId,
          requestHash,
          resultRefType: 'booking',
          resultRefId: created.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
      }
      const dto = await toBookingDto(tx, created.id);
      if (dto === null) throw new AppError('RESOURCE_NOT_FOUND');
      return dto;
    });
  } catch (error) {
    throw mapPgError(error);
  }
}

async function assertCapacityAvailable(
  tx: Tx,
  facilityId: string,
  starts: Date[],
  ends: Map<string, Date>,
  capacity: number,
  slotMinutes: number,
): Promise<void> {
  const ordered = [...starts].sort((left, right) => left.getTime() - right.getTime());
  const rangeStart = ordered[0] ?? new Date();
  const lastStart = ordered[ordered.length - 1] ?? rangeStart;
  const rangeEnd = new Date(lastStart.getTime() + slotMinutes * 60_000);
  const confirmed = await listConfirmedSlotsInRange(tx, { facilityId, rangeStart, rangeEnd });
  for (const start of starts) {
    const end = ends.get(start.toISOString());
    if (end === undefined) throw new AppError('BOOKING_SLOT_UNAVAILABLE');
    const overlapping = confirmed.filter((row) =>
      overlaps({ startsAt: start, endsAt: end }, { startsAt: row.startsAt, endsAt: row.endsAt }),
    ).length;
    const sameRequest = starts.filter((other) => {
      const otherEnd = ends.get(other.toISOString());
      if (otherEnd === undefined) return false;
      return overlaps({ startsAt: start, endsAt: end }, { startsAt: other, endsAt: otherEnd });
    }).length;
    if (overlapping + sameRequest > capacity) {
      throw new AppError('BOOKING_SLOT_UNAVAILABLE');
    }
  }
}

async function assertQuotaAvailable(
  tx: Tx,
  roomId: string,
  facilityId: string,
  starts: Date[],
  config: FacilityConfigRecord,
): Promise<void> {
  const grouped = groupSlotsByPeriod(starts, config.quotaKind);
  const [slots, credits] = await Promise.all([
    listQuotaConsumingSlots(tx, { roomId, facilityId }),
    listAdjustmentsForRoomFacility(tx, { roomId, facilityId }),
  ]);
  for (const [periodKey, requested] of grouped) {
    const used = countQuotaUsed({
      slots: slots.map((slot) => ({ id: slot.id, startsAt: slot.startsAt, state: slot.state })),
      credits: credits
        .filter((credit) => credit.periodKey === periodKey)
        .map((credit) => ({
          bookingSlotId: credit.bookingSlotId,
          signedSlots: credit.signedSlots,
        })),
      periodKey,
      kind: config.quotaKind,
    });
    if (used + requested > config.quotaLimit) {
      throw new AppError('BOOKING_QUOTA_EXCEEDED');
    }
  }
}

export interface CancelSlotInput {
  bookingId: string;
  slotId: string;
  reason: string;
  refundQuota?: boolean | undefined;
}

export async function cancelBookingSlot(
  actor: Actor,
  input: CancelSlotInput,
  ctx: BookingCtx,
): Promise<BookingDto> {
  requireUsableActor(actor);
  const now = ctx.clock.now();
  const booking = await findBookingById(db, input.bookingId);
  if (booking === null) throw new AppError('RESOURCE_NOT_FOUND');
  const isAdmin = actor.isSystemAdmin;
  if (!isAdmin) {
    const verdict = await canActInRoom(actor.userId, booking.roomId, 'BOOK_FACILITY', now).catch(
      (error: unknown) => {
        if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
        throw error;
      },
    );
    if (verdict === null || !verdict.allowed) throw new AppError('RESOURCE_NOT_FOUND');
  }
  if (!isAdmin && input.refundQuota === true) {
    throw new AppError('ACCESS_DENIED');
  }
  try {
    return await db.transaction(async (tx) => {
      const slot = await lockBookingSlotForUpdate(tx, input.slotId);
      if (slot === null || slot.bookingId !== input.bookingId) {
        throw new AppError('RESOURCE_NOT_FOUND');
      }
      if (slot.state !== 'CONFIRMED') {
        throw new AppError('VALIDATION_ERROR', 'Only confirmed slots can be cancelled.');
      }
      if (!isAdmin) assertResidentCancelAllowed(slot.startsAt, now);
      const nextState = nextCancelState(isAdmin);
      const refund = isAdmin && input.refundQuota === true;
      const updated = await updateBookingSlotState(tx, {
        slotId: slot.id,
        expectedState: 'CONFIRMED',
        nextState,
        canceledBy: actor.userId,
        refundQuota: refund,
      });
      if (updated === null)
        throw new AppError('VALIDATION_ERROR', 'The slot changed. Please reload and retry.');
      if (refund) {
        const config = await findEffectiveConfig(tx, slot.facilityId, now);
        if (config === null) {
          throw new AppError('VALIDATION_ERROR', 'The facility has no effective configuration.');
        }
        const periodKey = toPeriodKey(slot.startsAt, config.quotaKind);
        await ensureQuotaPeriodLocks(tx, {
          roomId: slot.roomId,
          facilityId: slot.facilityId,
          periodKeys: [periodKey],
        });
        await insertRefundCredit(tx, {
          bookingSlotId: slot.id,
          roomId: slot.roomId,
          facilityId: slot.facilityId,
          periodKey,
          reason: input.reason,
          actorId: actor.userId,
        });
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: isAdmin ? 'booking.slot.admin_cancelled' : 'booking.slot.resident_cancelled',
        resourceType: 'booking_slot',
        resourceId: slot.id,
        requestId: ctx.requestId,
        before: { state: 'CONFIRMED' },
        after: { state: nextState, refundQuota: refund },
      });
      const dto = await toBookingDto(tx, input.bookingId);
      if (dto === null) throw new AppError('RESOURCE_NOT_FOUND');
      return dto;
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { quota_adjustment_slot_type_uq: 'VALIDATION_ERROR' },
    });
  }
}

export async function listRoomBookings(
  actor: Actor,
  input: { roomId: string; facilityId?: string | undefined },
  at: Date,
): Promise<BookingDto[]> {
  requireUsableActor(actor);
  const verdict = await canActInRoom(actor.userId, input.roomId, 'BOOK_FACILITY', at).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    },
  );
  if (verdict === null || (!verdict.allowed && !actor.isSystemAdmin)) {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  const bookings = await listBookingsForRoom(db, input);
  const dtos: BookingDto[] = [];
  for (const booking of bookings) {
    const dto = await toBookingDto(db, booking.id);
    if (dto !== null) dtos.push(dto);
  }
  return dtos;
}

export async function getRoomBookingHistory(actor: Actor, roomId: string, at: Date) {
  const bookings = await listRoomBookings(actor, { roomId }, at);
  const labels = await listBookingFacilityLabels(db, [
    ...new Set(bookings.map((booking) => booking.facilityId)),
  ]);
  return {
    bookings,
    facilities: labels.map((row) => ({
      id: row.id,
      name: row.name,
      deleted: row.deletedAt !== null,
    })),
  };
}
