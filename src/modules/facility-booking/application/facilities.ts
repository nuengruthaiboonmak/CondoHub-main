import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import type { QuotaKind } from '@/shared/utils/clock';
import { assertValidSchedule, type FacilitySchedule } from '../domain/schedule';
import {
  queryFacilityPage,
  queryFacilityBookingPage,
  findFacilityById,
  hasUpcomingConfirmedSlots,
  lockFacilityForUpdate,
  markFacilityDeleted,
  insertClosure,
  insertFacility,
  insertFacilityConfig,
  listClosuresForFacility,
  listFacilityConfigs,
  updateFacility,
  type FacilityRecord,
} from '../infrastructure/facilityRepository';
import type { BookingCtx } from './ctx';

function requireUsableActor(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

function requireAdmin(actor: Actor): void {
  requireUsableActor(actor);
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
}

export interface FacilityDto {
  id: string;
  projectId: string;
  code: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  capacity: number;
}

function toFacilityDto(row: FacilityRecord): FacilityDto {
  return {
    id: row.id,
    projectId: row.projectId,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    capacity: row.capacity,
  };
}

export interface FacilityPage {
  rows: FacilityDto[];
  total: number;
}

export async function listFacilityPage(
  actor: Actor,
  input: {
    status?: 'ACTIVE' | 'INACTIVE' | undefined;
    query?: string | undefined;
    page: number;
    pageSize: number;
  },
): Promise<FacilityPage> {
  requireUsableActor(actor);
  const result = await queryFacilityPage(db, {
    ...input,
    page: Math.max(1, input.page),
    pageSize: Math.min(100, Math.max(1, input.pageSize)),
  });
  return { rows: result.rows.map(toFacilityDto), total: result.total };
}

export interface CreateFacilityInput {
  projectId: string;
  code?: string | undefined;
  name: string;
  description?: string | null | undefined;
  status: 'ACTIVE' | 'INACTIVE';
  capacity: number;
  schedule: FacilitySchedule;
  slotMinutes: number;
  quotaKind: QuotaKind;
  quotaLimit: number;
  advanceDays: number;
  effectiveAt?: Date | undefined;
}

export interface FacilityDetailDto extends FacilityDto {
  effectiveConfig: {
    id: string;
    version: number;
    effectiveAt: string;
    isPending: boolean;
    schedule: FacilitySchedule;
    slotMinutes: number;
    quotaKind: QuotaKind;
    quotaLimit: number;
    advanceDays: number;
  } | null;
  pendingConfig: {
    id: string;
    version: number;
    effectiveAt: string;
    schedule: FacilitySchedule;
    slotMinutes: number;
    quotaKind: QuotaKind;
    quotaLimit: number;
    advanceDays: number;
  } | null;
  closures: Array<{ id: string; startsAt: string; endsAt: string; reason: string }>;
}

export async function createFacility(
  actor: Actor,
  input: CreateFacilityInput,
  ctx: BookingCtx,
): Promise<FacilityDetailDto> {
  requireAdmin(actor);
  if (input.effectiveAt !== undefined && !ctx.isSeedActor) {
    throw new AppError('VALIDATION_ERROR', 'The effective time is reserved for seed actors.');
  }
  assertValidSchedule(input.schedule);
  const now = ctx.clock.now();
  const effectiveAt = input.effectiveAt ?? now;
  if (!ctx.isSeedActor && effectiveAt.getTime() < now.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'The effective time must not be in the past.');
  }
  try {
    const facilityId = await db.transaction(async (tx) => {
      const created = await insertFacility(tx, {
        projectId: input.projectId,
        code: input.code ?? `fac_${crypto.randomUUID()}`,
        name: input.name,
        description: input.description ?? null,
        status: input.status,
        capacity: input.capacity,
      });
      await insertFacilityConfig(tx, {
        facilityId: created.id,
        version: 1,
        effectiveAt,
        isPending: effectiveAt.getTime() > now.getTime(),
        scheduleJson: input.schedule,
        slotMinutes: input.slotMinutes,
        quotaKind: input.quotaKind,
        quotaLimit: input.quotaLimit,
        advanceDays: input.advanceDays,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'facility.created',
        resourceType: 'facility',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: {
          code: created.code,
          name: created.name,
          capacity: created.capacity,
          backdated: input.effectiveAt !== undefined,
        },
      });
      return created.id;
    });
    const detail = await getFacilityDetail(actor, facilityId, now);
    if (detail === null) throw new AppError('RESOURCE_NOT_FOUND');
    return detail;
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: {
        facility_project_code_uq: 'VALIDATION_ERROR',
        facility_config_pending_puq: 'VERSION_CONFLICT',
      },
    });
  }
}

export async function updateFacilityDetails(
  actor: Actor,
  facilityId: string,
  input: {
    name?: string | undefined;
    description?: string | null | undefined;
    status?: 'ACTIVE' | 'INACTIVE' | undefined;
    capacity?: number | undefined;
  },
  ctx: BookingCtx,
): Promise<FacilityDto> {
  requireAdmin(actor);
  try {
    const updated = await db.transaction(async (tx) => {
      const before = await findFacilityById(tx, facilityId);
      if (before === null) throw new AppError('RESOURCE_NOT_FOUND');
      const next = await updateFacility(tx, facilityId, input);
      if (next === null) throw new AppError('RESOURCE_NOT_FOUND');
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'facility.updated',
        resourceType: 'facility',
        resourceId: facilityId,
        requestId: ctx.requestId,
        before: { name: before.name, status: before.status, capacity: before.capacity },
        after: { name: next.name, status: next.status, capacity: next.capacity },
      });
      return next;
    });
    return toFacilityDto(updated);
  } catch (error) {
    throw mapPgError(error);
  }
}

export async function getFacilityDetail(
  actor: Actor,
  facilityId: string,
  at: Date,
): Promise<FacilityDetailDto | null> {
  requireUsableActor(actor);
  const row = await findFacilityById(db, facilityId);
  if (row === null) return null;
  const [configs, closures] = await Promise.all([
    listFacilityConfigs(db, facilityId),
    listClosuresForFacility(db, facilityId),
  ]);
  const effective =
    configs
      .filter((config) => config.effectiveAt.getTime() <= at.getTime())
      .sort(
        (left, right) =>
          right.effectiveAt.getTime() - left.effectiveAt.getTime() || right.version - left.version,
      )[0] ?? null;
  const pending = configs.find((config) => config.isPending) ?? null;
  return {
    ...toFacilityDto(row),
    effectiveConfig:
      effective === null
        ? null
        : {
            id: effective.id,
            version: effective.version,
            effectiveAt: effective.effectiveAt.toISOString(),
            isPending: effective.isPending,
            schedule: effective.scheduleJson as FacilitySchedule,
            slotMinutes: effective.slotMinutes,
            quotaKind: effective.quotaKind,
            quotaLimit: effective.quotaLimit,
            advanceDays: effective.advanceDays,
          },
    pendingConfig:
      pending === null
        ? null
        : {
            id: pending.id,
            version: pending.version,
            effectiveAt: pending.effectiveAt.toISOString(),
            schedule: pending.scheduleJson as FacilitySchedule,
            slotMinutes: pending.slotMinutes,
            quotaKind: pending.quotaKind,
            quotaLimit: pending.quotaLimit,
            advanceDays: pending.advanceDays,
          },
    closures: closures.map((closure) => ({
      id: closure.id,
      startsAt: closure.startsAt.toISOString(),
      endsAt: closure.endsAt.toISOString(),
      reason: closure.reason,
    })),
  };
}

export async function createClosure(
  actor: Actor,
  facilityId: string,
  input: { startsAt: Date; endsAt: Date; reason: string },
  ctx: BookingCtx,
): Promise<{ id: string; startsAt: string; endsAt: string; reason: string }> {
  requireAdmin(actor);
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'The closure end must be after its start.');
  }
  try {
    const created = await db.transaction(async (tx) => {
      const facilityRow = await findFacilityById(tx, facilityId);
      if (facilityRow === null) throw new AppError('RESOURCE_NOT_FOUND');
      const closure = await insertClosure(tx, {
        facilityId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason,
        author: actor.userId,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'facility.closure.created',
        resourceType: 'facility_closure',
        resourceId: closure.id,
        requestId: ctx.requestId,
        after: {
          facilityId,
          startsAt: closure.startsAt.toISOString(),
          endsAt: closure.endsAt.toISOString(),
        },
      });
      return closure;
    });
    return {
      id: created.id,
      startsAt: created.startsAt.toISOString(),
      endsAt: created.endsAt.toISOString(),
      reason: created.reason,
    };
  } catch (error) {
    throw mapPgError(error);
  }
}

export async function listFacilityBookings(
  actor: Actor,
  input: { facilityId: string; page: number; pageSize: number },
) {
  requireAdmin(actor);
  const facility = await findFacilityById(db, input.facilityId);
  if (!facility) throw new AppError('RESOURCE_NOT_FOUND');
  return queryFacilityBookingPage(
    db,
    input.facilityId,
    Math.max(1, input.page),
    Math.min(100, Math.max(1, input.pageSize)),
  );
}

export async function deleteFacility(
  actor: Actor,
  facilityId: string,
  ctx: BookingCtx,
): Promise<{ id: string }> {
  requireAdmin(actor);
  const now = ctx.clock.now();
  try {
    return await db.transaction(async (tx) => {
      const before = await lockFacilityForUpdate(tx, facilityId);
      if (!before) throw new AppError('RESOURCE_NOT_FOUND');
      if (await hasUpcomingConfirmedSlots(tx, facilityId, now)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Cancel active or upcoming bookings before deleting this facility.',
        );
      }
      await markFacilityDeleted(tx, facilityId, now);
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'facility.deleted',
        resourceType: 'facility',
        resourceId: facilityId,
        requestId: ctx.requestId,
        before: { status: before.status },
        after: { deletedAt: now.toISOString() },
      });
      return { id: facilityId };
    });
  } catch (error) {
    throw mapPgError(error);
  }
}
