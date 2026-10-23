import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import type { QuotaKind } from '@/shared/utils/clock';
import { assertValidSchedule, type FacilitySchedule } from '../domain/schedule';
import {
  findFacilityById,
  insertBooking,
  insertBookingSlots,
  insertClosure,
  insertFacility,
  insertFacilityConfig,
  insertRefundCredit,
  lockBookingSlotForUpdate,
  maxConfigVersion,
  updateBookingSlotState,
} from '../infrastructure/facilityRepository';
import { createBooking } from './bookings';
import type { BookingCtx } from './ctx';

export interface SeedFacilityInput {
  projectId: string;
  code: string;
  name: string;
  description?: string | null | undefined;
  status: 'ACTIVE' | 'INACTIVE';
  capacity: number;
  schedule: FacilitySchedule;
  slotMinutes: number;
  quotaKind: QuotaKind;
  quotaLimit: number;
  advanceDays: number;
  effectiveAt: Date;
  pending?: {
    schedule: FacilitySchedule;
    slotMinutes: number;
    quotaKind: QuotaKind;
    quotaLimit: number;
    advanceDays: number;
    effectiveAt: Date;
  } | null | undefined;
  closures?: Array<{ startsAt: Date; endsAt: Date; reason: string }> | undefined;
}

export interface SeedBookingInput {
  roomId: string;
  startsAt: string[];
}

export interface SeedBookingResult {
  bookingId: string;
  slotIds: string[];
}

function requireSeedAdmin(actor: Actor, ctx: BookingCtx): void {
  if (!ctx.isSeedActor) throw new AppError('ACCESS_DENIED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
}

export async function seedFacility(
  actor: Actor,
  input: SeedFacilityInput,
  ctx: BookingCtx,
): Promise<{ facilityId: string }> {
  requireSeedAdmin(actor, ctx);
  assertValidSchedule(input.schedule);
  if (input.pending !== undefined && input.pending !== null) {
    assertValidSchedule(input.pending.schedule);
  }
  try {
    return await db.transaction(async (tx) => {
      const created = await insertFacility(tx, {
        projectId: input.projectId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        status: input.status,
        capacity: input.capacity,
      });
      await insertFacilityConfig(tx, {
        facilityId: created.id,
        version: 1,
        effectiveAt: input.effectiveAt,
        isPending: false,
        scheduleJson: input.schedule,
        slotMinutes: input.slotMinutes,
        quotaKind: input.quotaKind,
        quotaLimit: input.quotaLimit,
        advanceDays: input.advanceDays,
      });
      if (input.pending !== undefined && input.pending !== null) {
        const version = (await maxConfigVersion(tx, created.id)) + 1;
        await insertFacilityConfig(tx, {
          facilityId: created.id,
          version,
          effectiveAt: input.pending.effectiveAt,
          isPending: true,
          scheduleJson: input.pending.schedule,
          slotMinutes: input.pending.slotMinutes,
          quotaKind: input.pending.quotaKind,
          quotaLimit: input.pending.quotaLimit,
          advanceDays: input.pending.advanceDays,
        });
      }
      for (const closure of input.closures ?? []) {
        await insertClosure(tx, {
          facilityId: created.id,
          startsAt: closure.startsAt,
          endsAt: closure.endsAt,
          reason: closure.reason,
          author: actor.userId,
        });
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'facility.seed.created',
        resourceType: 'facility',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { code: created.code, name: created.name },
      });
      return { facilityId: created.id };
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: {
        facility_project_code_uq: 'VALIDATION_ERROR',
        facility_config_pending_puq: 'VERSION_CONFLICT',
      },
    });
  }
}

export async function seedBooking(
  actor: Actor,
  facilityId: string,
  input: SeedBookingInput,
  ctx: BookingCtx,
): Promise<SeedBookingResult> {
  requireSeedAdmin(actor, ctx);
  const facility = await findFacilityById(db, facilityId);
  if (facility === null) throw new AppError('RESOURCE_NOT_FOUND');
  const created = await createBooking(
    { ...actor, isSystemAdmin: true },
    { facilityId, roomId: input.roomId, startsAt: input.startsAt },
    { ...ctx, isSeedActor: false },
  );
  return { bookingId: created.id, slotIds: created.slots.map((slot) => slot.id) };
}

export async function seedDirectBooking(
  actor: Actor,
  input: {
    facilityId: string;
    roomId: string;
    slots: Array<{ startsAt: Date; endsAt: Date }>;
    createdBy: string | null;
  },
  ctx: BookingCtx,
): Promise<SeedBookingResult> {
  requireSeedAdmin(actor, ctx);
  try {
    return await db.transaction(async (tx) => {
      const facility = await findFacilityById(tx, input.facilityId);
      if (facility === null) throw new AppError('RESOURCE_NOT_FOUND');
      const booking = await insertBooking(tx, {
        roomId: input.roomId,
        facilityId: input.facilityId,
        createdBy: input.createdBy,
      });
      const slots = await insertBookingSlots(
        tx,
        input.slots.map((slot) => ({
          bookingId: booking.id,
          facilityId: input.facilityId,
          roomId: input.roomId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        })),
      );
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'booking.seed.created',
        resourceType: 'booking',
        resourceId: booking.id,
        requestId: ctx.requestId,
        after: { facilityId: input.facilityId, roomId: input.roomId, slotCount: slots.length },
      });
      return { bookingId: booking.id, slotIds: slots.map((slot) => slot.id) };
    });
  } catch (error) {
    throw mapPgError(error);
  }
}

export async function seedCancelSlot(
  actor: Actor,
  input: {
    bookingId: string;
    slotId: string;
    refundQuota: boolean;
    reason: string;
    periodKey: string;
    roomId: string;
    facilityId: string;
    admin: boolean;
  },
  ctx: BookingCtx,
): Promise<void> {
  requireSeedAdmin(actor, ctx);
  try {
    await db.transaction(async (tx) => {
      const slot = await lockBookingSlotForUpdate(tx, input.slotId);
      if (slot === null || slot.bookingId !== input.bookingId) {
        throw new AppError('RESOURCE_NOT_FOUND');
      }
      if (slot.state !== 'CONFIRMED') throw new AppError('VALIDATION_ERROR', 'The slot is not confirmed.');
      const updated = await updateBookingSlotState(tx, {
        slotId: slot.id,
        expectedState: 'CONFIRMED',
        nextState: input.admin ? 'ADMIN_CANCELLED' : 'RESIDENT_CANCELLED',
        canceledBy: actor.userId,
        refundQuota: input.refundQuota,
      });
      if (updated === null) throw new AppError('VALIDATION_ERROR', 'The slot changed.');
      if (input.refundQuota) {
        await insertRefundCredit(tx, {
          bookingSlotId: slot.id,
          roomId: input.roomId,
          facilityId: input.facilityId,
          periodKey: input.periodKey,
          reason: input.reason,
          actorId: actor.userId,
        });
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'booking.seed.cancelled',
        resourceType: 'booking_slot',
        resourceId: slot.id,
        requestId: ctx.requestId,
        after: { admin: input.admin, refundQuota: input.refundQuota },
      });
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { quota_adjustment_slot_type_uq: 'VALIDATION_ERROR' },
    });
  }
}
