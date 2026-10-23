import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { canPlaceTenancy } from '../domain/tenancyPolicy';
import { canManageTenancy } from '../domain/managementModeGuards';
import { isOwnerAt, type OwnershipInterval } from '../domain/ownershipPolicy';
import type { ManagementMode } from '../infrastructure/schema';
import {
  findRoomById,
  lockPropertyScope,
  isRoomOperational,
} from '../infrastructure/structureRepository';
import { listOwnershipsByRoom } from '../infrastructure/ownershipRepository';
import {
  endTenancy,
  findTenancyById,
  insertTenancy,
  listActiveTenanciesByRoom,
  listTenanciesByRoom,
  lockTenancyById,
  cancelTenancy,
  type TenancyRow,
} from '../infrastructure/tenancyRepository';
import { endMembership, listMembershipsByTenancy } from '../infrastructure/membershipRepository';
import type { PropertyCtx } from './ctx';
import type { Tx } from '@/shared/db/transaction';

export async function lockTenancyForBilling(tx: Tx, tenancyId: string): Promise<boolean> {
  const tenancy = await lockTenancyById(tx, tenancyId);
  return tenancy !== null && tenancy.state !== 'CANCELLED';
}

export interface CreateTenancyInput {
  roomId: string;
  startsAt: Date;
  endsAt?: Date | null | undefined;
  managementMode: ManagementMode;
  effectiveAt?: Date | undefined;
}

export async function createTenancy(
  actor: Actor,
  input: CreateTenancyInput,
  ctx: PropertyCtx,
): Promise<TenancyRow> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  if (input.effectiveAt !== undefined && !ctx.isSeedActor) {
    throw new AppError('VALIDATION_ERROR', 'The effective time is reserved for seed actors.');
  }
  const room = await findRoomById(db, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  const now = ctx.clock.now();
  const ownerships = await listOwnershipsByRoom(db, input.roomId);
  const intervals: OwnershipInterval[] = ownerships.map((row) => ({
    roomId: row.roomId,
    userId: row.userId,
    start: row.startAt,
    end: row.endAt,
  }));
  const actorIsOwner = isOwnerAt(intervals, input.roomId, actor.userId, now);
  const managed = canManageTenancy(input.managementMode, {
    actorIsSystemAdmin: actor.isSystemAdmin,
    actorIsActiveOwner: actorIsOwner,
  });
  if (!managed) throw new AppError('ACCESS_DENIED');
  const startsAt = input.effectiveAt ?? input.startsAt;
  const endsAt = input.endsAt ?? null;
  if (endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'The tenancy interval is invalid.');
  }
  const existing = await listTenanciesByRoom(db, input.roomId);
  const placement = canPlaceTenancy({
    roomId: input.roomId,
    startsAt,
    endsAt,
    existing: existing.map((row) => ({
      roomId: row.roomId,
      state: row.state,
      start: row.startsAt,
      end: row.endsAt,
    })),
  });
  if (!placement.allowed) {
    throw new AppError('VALIDATION_ERROR', 'The tenancy overlaps an active tenancy.');
  }
  try {
    return await db.transaction(async (tx) => {
      if (!(await lockPropertyScope(tx, 'room', input.roomId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      if (!ctx.isSeedActor && !(await isRoomOperational(tx, input.roomId)))
        throw new AppError(
          'VALIDATION_ERROR',
          'Reactivate the room, floor and building before starting a rental.',
        );
      const created = await insertTenancy(tx, {
        roomId: input.roomId,
        startsAt,
        endsAt,
        managementMode: input.managementMode,
        createdBy: actor.userId,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'tenancy.created',
        resourceType: 'rental_period',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: {
          roomId: input.roomId,
          managementMode: input.managementMode,
          startsAt: created.startsAt.toISOString(),
          backdated: input.effectiveAt !== undefined,
        },
      });
      return created;
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { rental_period_active_no_overlap_ex: 'VALIDATION_ERROR' },
      fallbackCodes: { '23P01': 'VALIDATION_ERROR' },
    });
  }
}

export async function endTenancyAt(
  actor: Actor,
  input: { tenancyId: string; endsAt?: Date | undefined },
  ctx: PropertyCtx,
): Promise<TenancyRow> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const tenancy = await findTenancyById(db, input.tenancyId);
  if (tenancy === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (tenancy.state !== 'ACTIVE') {
    throw new AppError('VALIDATION_ERROR', 'The tenancy is already ended.');
  }
  const now = ctx.clock.now();
  const endsAt = input.endsAt ?? now;
  if (endsAt.getTime() <= tenancy.startsAt.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'The tenancy end must be after its start.');
  }
  const ownerships = await listOwnershipsByRoom(db, tenancy.roomId);
  const intervals: OwnershipInterval[] = ownerships.map((row) => ({
    roomId: row.roomId,
    userId: row.userId,
    start: row.startAt,
    end: row.endAt,
  }));
  const managed = canManageTenancy(tenancy.managementMode, {
    actorIsSystemAdmin: actor.isSystemAdmin,
    actorIsActiveOwner: isOwnerAt(intervals, tenancy.roomId, actor.userId, now),
  });
  if (!managed) throw new AppError('ACCESS_DENIED');
  try {
    return await db.transaction(async (tx) => {
      const current = await lockTenancyById(tx, tenancy.id);
      if (!current || current.state !== 'ACTIVE')
        throw new AppError(
          'VALIDATION_ERROR',
          'This rental period is no longer active. Reload and try again.',
        );
      const ended = await endTenancy(tx, tenancy.id, endsAt);
      if (ended === null) throw new AppError('RESOURCE_NOT_FOUND');
      const memberships = await listMembershipsByTenancy(tx, tenancy.id);
      for (const membership of memberships) {
        if (membership.endAt !== null) continue;
        await endMembership(tx, membership.id, endsAt);
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'tenancy.ended',
        resourceType: 'rental_period',
        resourceId: tenancy.id,
        requestId: ctx.requestId,
        before: { state: 'ACTIVE' },
        after: { state: 'ENDED', endsAt: endsAt.toISOString() },
      });
      return ended;
    });
  } catch (error) {
    throw mapPgError(error);
  }
}

export async function cancelScheduledTenancy(
  actor: Actor,
  tenancyId: string,
  ctx: PropertyCtx,
): Promise<TenancyRow> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const now = ctx.clock.now();
  return db.transaction(async (tx) => {
    const tenancy = await lockTenancyById(tx, tenancyId);
    if (!tenancy) throw new AppError('RESOURCE_NOT_FOUND');
    const ownerships = await listOwnershipsByRoom(tx, tenancy.roomId);
    const managed = canManageTenancy(tenancy.managementMode, {
      actorIsSystemAdmin: actor.isSystemAdmin,
      actorIsActiveOwner: isOwnerAt(
        ownerships.map((row) => ({
          roomId: row.roomId,
          userId: row.userId,
          start: row.startAt,
          end: row.endAt,
        })),
        tenancy.roomId,
        actor.userId,
        now,
      ),
    });
    if (!managed) throw new AppError('ACCESS_DENIED');
    if (tenancy.state !== 'ACTIVE')
      throw new AppError(
        'VALIDATION_ERROR',
        'This rental period is no longer active. Reload and try again.',
      );
    if (tenancy.startsAt <= now)
      throw new AppError(
        'VALIDATION_ERROR',
        'This rental has started. End the rental period instead.',
      );
    const cancelled = await cancelTenancy(tx, tenancy.id);
    if (!cancelled) throw new AppError('VERSION_CONFLICT');
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'tenancy.cancelled',
      resourceType: 'rental_period',
      resourceId: tenancy.id,
      requestId: ctx.requestId,
      before: { state: tenancy.state },
      after: { state: 'CANCELLED' },
    });
    return cancelled;
  });
}

export async function listRoomTenancies(roomId: string): Promise<TenancyRow[]> {
  const room = await findRoomById(db, roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  return listTenanciesByRoom(db, roomId);
}

export async function listRoomActiveTenancies(roomId: string): Promise<TenancyRow[]> {
  const room = await findRoomById(db, roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  return listActiveTenanciesByRoom(db, roomId);
}
