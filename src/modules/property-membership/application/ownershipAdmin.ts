import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { getIdempotencyRecord, upsertIdempotencyRecord } from './idempotencyStore';
import { hashRequestBody } from '@/shared/utils/idempotency';
import { writeAudit } from '@/shared/observability/audit';
import { createIdentityCtx, resolveOrCreateGrantUser } from '@/modules/identity-access/application/index';
import { findUserById } from '@/modules/identity-access/infrastructure/userRepository';
import { resolveGrantTargetByUsername } from './grantCoOwner';
import { isOwnerAt, type OwnershipInterval } from '../domain/ownershipPolicy';
import { findRoomById } from '../infrastructure/structureRepository';
import {
  correctOwnership,
  endOwnership,
  findOwnershipById,
  insertOwnership,
  listOwnershipsByRoom,
} from '../infrastructure/ownershipRepository';
import type { PropertyCtx } from './ctx';

function requireAdmin(actor: Actor): void {
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
}

function toIntervals(
  rows: Array<{ roomId: string; userId: string; startAt: Date; endAt: Date | null }>,
): OwnershipInterval[] {
  return rows.map((row) => ({
    roomId: row.roomId,
    userId: row.userId,
    start: row.startAt,
    end: row.endAt,
  }));
}

export interface TransferOwnershipInput {
  roomId: string;
  fromUserId: string;
  toUserId: string;
  effectiveAt: Date;
  idempotencyKey?: string | undefined;
}

export interface TransferOwnershipResult {
  endedOwnershipId: string;
  createdOwnershipId: string;
  effectiveAt: Date;
}

export async function transferOwnership(
  actor: Actor,
  input: TransferOwnershipInput,
  ctx: PropertyCtx,
): Promise<TransferOwnershipResult> {
  requireAdmin(actor);
  const room = await findRoomById(db, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (input.fromUserId === input.toUserId) {
    throw new AppError('VALIDATION_ERROR', 'The transfer source and target must differ.');
  }
  const [fromUser, toUser] = await Promise.all([
    findUserById(db, input.fromUserId),
    findUserById(db, input.toUserId),
  ]);
  if (fromUser === null || toUser === null) {
    throw new AppError('VALIDATION_ERROR', 'The transfer user was not found.');
  }
  if (toUser.accountStatus !== 'ACTIVE') {
    throw new AppError('VALIDATION_ERROR', 'The target user cannot receive ownership.');
  }
  const ownerships = await listOwnershipsByRoom(db, input.roomId);
  const activeFrom = ownerships.find(
    (row) =>
      row.userId === input.fromUserId &&
      row.startAt.getTime() <= input.effectiveAt.getTime() &&
      (row.endAt === null || row.endAt.getTime() > input.effectiveAt.getTime()),
  );
  if (activeFrom === undefined) {
    throw new AppError('VALIDATION_ERROR', 'The source owner holds no interval at the effective time.');
  }
  try {
    return await db.transaction(async (tx) => {
      const ended = await endOwnership(tx, activeFrom.id, input.effectiveAt);
      if (ended === null) throw new AppError('RESOURCE_NOT_FOUND');
      const created = await insertOwnership(tx, {
        roomId: input.roomId,
        userId: input.toUserId,
        startAt: input.effectiveAt,
        grantedBy: actor.userId,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'ownership.transferred',
        resourceType: 'room_ownership',
        resourceId: created.id,
        requestId: ctx.requestId,
        before: { ownershipId: activeFrom.id, userId: input.fromUserId },
        after: {
          roomId: input.roomId,
          toUserId: input.toUserId,
          effectiveAt: input.effectiveAt.toISOString(),
        },
      });
      return {
        endedOwnershipId: activeFrom.id,
        createdOwnershipId: created.id,
        effectiveAt: input.effectiveAt,
      };
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { room_ownership_no_overlap_ex: 'VALIDATION_ERROR' },
      fallbackCodes: { '23P01': 'VALIDATION_ERROR' },
    });
  }
}

export interface AssignOwnerInput {
  roomId: string;
  userId?: string | undefined;
  username?: string | undefined;
  email?: string | undefined;
  name?: string | undefined;
  phone?: string | undefined;
  effectiveAt?: Date | undefined;
  idempotencyKey?: string | undefined;
}

export interface AssignOwnerResult {
  ownershipId: string;
  userId: string;
  startAt: Date;
  tempPassword?: string | undefined;
}

export async function assignOwner(
  actor: Actor,
  input: AssignOwnerInput,
  ctx: PropertyCtx,
): Promise<AssignOwnerResult> {
  requireAdmin(actor);
  const room = await findRoomById(db, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (input.userId === undefined && input.username === undefined) {
    throw new AppError('VALIDATION_ERROR', 'Provide a userId or username.');
  }
  const startAt = input.effectiveAt ?? ctx.clock.now();
  const requestHash = hashRequestBody({
    roomId: input.roomId,
    userId: input.userId ?? null,
    username: input.username ?? null,
    email: input.email ?? null,
    name: input.name ?? null,
    phone: input.phone ?? null,
    effectiveAt: input.effectiveAt?.toISOString() ?? null,
  });
  if (input.idempotencyKey !== undefined) {
    const existing = await getIdempotencyRecord(db, {
      scope: 'OWNER_ASSIGN',
      key: input.idempotencyKey,
    });
    if (existing !== null) {
      if (existing.requestHash !== requestHash) {
        throw new AppError('VALIDATION_ERROR', 'The Idempotency-Key was already used with a different request.');
      }
      if (existing.resultRefId !== null) {
        const replay = await findOwnershipById(db, existing.resultRefId);
        if (replay !== null && replay.roomId === input.roomId) {
          return { ownershipId: replay.id, userId: replay.userId, startAt: replay.startAt };
        }
      }
      throw new AppError('RATE_LIMITED');
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const identityCtx = createIdentityCtx({ requestId: ctx.requestId });
      let targetUserId = input.userId ?? null;
      let tempPassword: string | undefined;
      if (targetUserId === null && input.username !== undefined) {
        const existing = await resolveGrantTargetByUsername(input.username, tx);
        if (existing !== null) targetUserId = existing.userId;
      }
      if (targetUserId === null) {
        if (input.email === undefined || input.name === undefined) {
          throw new AppError('VALIDATION_ERROR', 'The user was not found. Provide an email and name to create an account.');
        }
        const resolved = await resolveOrCreateGrantUser(
          tx,
          {
            username: input.username,
            email: input.email,
            name: input.name,
            phone: input.phone,
          },
          identityCtx,
        );
        targetUserId = resolved.userId;
        if (resolved.created) tempPassword = resolved.tempPassword;
      }
      const target = await findUserById(tx, targetUserId);
      if (target === null) throw new AppError('VALIDATION_ERROR', 'The target user was not found.');
      if (target.accountStatus !== 'ACTIVE') {
        throw new AppError('VALIDATION_ERROR', 'The target user cannot receive ownership.');
      }
      const ownerships = await listOwnershipsByRoom(tx, input.roomId);
      const alreadyOwner = ownerships.some(
        (row) =>
          row.userId === targetUserId &&
          row.startAt.getTime() <= startAt.getTime() &&
          (row.endAt === null || row.endAt.getTime() > startAt.getTime()),
      );
      if (alreadyOwner) {
        throw new AppError('VALIDATION_ERROR', 'The user already owns this room.');
      }
      const created = await insertOwnership(tx, {
        roomId: input.roomId,
        userId: targetUserId,
        startAt,
        grantedBy: actor.userId,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'ownership.assigned',
        resourceType: 'room_ownership',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { roomId: input.roomId, userId: targetUserId, startAt: created.startAt.toISOString() },
      });
      if (input.idempotencyKey !== undefined) {
        await upsertIdempotencyRecord(tx, {
          scope: 'OWNER_ASSIGN',
          key: input.idempotencyKey,
          actorId: actor.userId,
          requestHash,
          resultRefType: 'room_ownership',
          resultRefId: created.id,
          expiresAt: new Date(ctx.clock.now().getTime() + 24 * 60 * 60 * 1000),
        });
      }
      return {
        ownershipId: created.id,
        userId: targetUserId,
        startAt: created.startAt,
        ...(tempPassword !== undefined ? { tempPassword } : {}),
      };
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { room_ownership_no_overlap_ex: 'VALIDATION_ERROR' },
      fallbackCodes: { '23P01': 'VALIDATION_ERROR' },
    });
  }
}

export async function removeOwnership(
  actor: Actor,
  input: { roomId: string; ownershipId: string; effectiveAt: Date },
  ctx: PropertyCtx,
): Promise<{ ownershipId: string; effectiveAt: Date }> {
  requireAdmin(actor);
  const room = await findRoomById(db, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  const ownership = await findOwnershipById(db, input.ownershipId);
  if (ownership === null || ownership.roomId !== input.roomId) {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  try {
    const ended = await db.transaction(async (tx) => {
      const next = await endOwnership(tx, input.ownershipId, input.effectiveAt);
      if (next === null) throw new AppError('RESOURCE_NOT_FOUND');
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'ownership.removed',
        resourceType: 'room_ownership',
        resourceId: input.ownershipId,
        requestId: ctx.requestId,
        before: { userId: ownership.userId, startAt: ownership.startAt.toISOString() },
        after: { effectiveAt: input.effectiveAt.toISOString() },
      });
      return next;
    });
    return { ownershipId: ended.id, effectiveAt: input.effectiveAt };
  } catch (error) {
    throw mapPgError(error);
  }
}

export async function correctOwnershipInterval(
  actor: Actor,
  input: {
    roomId: string;
    ownershipId: string;
    startAt?: Date | undefined;
    endAt?: Date | null | undefined;
    reason: string;
  },
  ctx: PropertyCtx,
): Promise<{ ownershipId: string }> {
  requireAdmin(actor);
  const room = await findRoomById(db, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  const ownership = await findOwnershipById(db, input.ownershipId);
  if (ownership === null || ownership.roomId !== input.roomId) {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  const nextStart = input.startAt ?? ownership.startAt;
  const nextEnd = input.endAt === undefined ? ownership.endAt : input.endAt;
  if (nextEnd !== null && nextEnd.getTime() <= nextStart.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'The corrected interval is invalid.');
  }
  try {
    await db.transaction(async (tx) => {
      const corrected = await correctOwnership(tx, input.ownershipId, {
        startAt: input.startAt,
        endAt: input.endAt,
      });
      if (corrected === null) throw new AppError('RESOURCE_NOT_FOUND');
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'ownership.corrected',
        resourceType: 'room_ownership',
        resourceId: input.ownershipId,
        requestId: ctx.requestId,
        before: {
          startAt: ownership.startAt.toISOString(),
          endAt: ownership.endAt === null ? null : ownership.endAt.toISOString(),
        },
        after: {
          startAt: corrected.startAt.toISOString(),
          endAt: corrected.endAt === null ? null : corrected.endAt.toISOString(),
          reason: input.reason,
        },
      });
    });
    return { ownershipId: input.ownershipId };
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { room_ownership_no_overlap_ex: 'VALIDATION_ERROR' },
      fallbackCodes: { '23P01': 'VALIDATION_ERROR' },
    });
  }
}

export async function assertActorIsActiveOwner(
  roomId: string,
  userId: string,
  at: Date,
): Promise<void> {
  const ownerships = await listOwnershipsByRoom(db, roomId);
  if (!isOwnerAt(toIntervals(ownerships), roomId, userId, at)) {
    throw new AppError('ACCESS_DENIED');
  }
}
