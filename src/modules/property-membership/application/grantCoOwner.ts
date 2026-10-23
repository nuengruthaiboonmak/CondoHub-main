import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { getIdempotencyRecord, upsertIdempotencyRecord } from './idempotencyStore';
import { hashRequestBody } from '@/shared/utils/idempotency';
import { writeAudit } from '@/shared/observability/audit';
import {
  createIdentityCtx,
  resolveOrCreateGrantUser,
} from '@/modules/identity-access/application/index';
import {
  findUserById,
  findUserByUsername,
} from '@/modules/identity-access/infrastructure/userRepository';
import { isOwnerAt, type OwnershipInterval } from '../domain/ownershipPolicy';
import { findRoomById } from '../infrastructure/structureRepository';
import { insertOwnership, listOwnershipsByRoom } from '../infrastructure/ownershipRepository';
import type { PropertyCtx } from './ctx';

export interface GrantCoOwnerInput {
  roomId: string;
  userId?: string | undefined;
  username?: string | undefined;
  email?: string | undefined;
  name?: string | undefined;
  phone?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface GrantCoOwnerResult {
  ownershipId: string;
  userId: string;
  startAt: Date;
  tempPassword?: string | undefined;
}

export async function grantCoOwner(
  actor: Actor,
  input: GrantCoOwnerInput,
  ctx: PropertyCtx,
): Promise<GrantCoOwnerResult> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const room = await findRoomById(db, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (input.userId === undefined && input.username === undefined) {
    throw new AppError('VALIDATION_ERROR', 'Provide a userId or username.');
  }
  const now = ctx.clock.now();
  const ownerships = await listOwnershipsByRoom(db, input.roomId);
  const intervals: OwnershipInterval[] = ownerships.map((row) => ({
    roomId: row.roomId,
    userId: row.userId,
    start: row.startAt,
    end: row.endAt,
  }));
  if (!isOwnerAt(intervals, input.roomId, actor.userId, now)) {
    throw new AppError('ACCESS_DENIED');
  }
  const requestHash = hashRequestBody({
    roomId: input.roomId,
    userId: input.userId ?? null,
    username: input.username ?? null,
    email: input.email ?? null,
    name: input.name ?? null,
    phone: input.phone ?? null,
  });
  if (input.idempotencyKey !== undefined) {
    const existing = await getIdempotencyRecord(db, {
      scope: 'CO_OWNER_GRANT',
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
        const replay = ownerships.find((row) => row.id === existing.resultRefId);
        if (replay !== undefined) {
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
          throw new AppError(
            'VALIDATION_ERROR',
            'The user was not found. Provide an email and name to create an account.',
          );
        }
        const resolved = await resolveOrCreateGrantUser(
          tx,
          {
            username: input.username,
            email: input.email ?? '',
            name: input.name ?? '',
            phone: input.phone,
          },
          identityCtx,
        );
        targetUserId = resolved.userId;
        if (resolved.created) tempPassword = resolved.tempPassword;
      } else {
        const target = await findUserById(tx, targetUserId);
        if (target === null)
          throw new AppError('VALIDATION_ERROR', 'The target user was not found.');
        if (target.accountStatus !== 'ACTIVE') {
          throw new AppError('VALIDATION_ERROR', 'The target user cannot receive ownership.');
        }
      }
      const fresh = await listOwnershipsByRoom(tx, input.roomId);
      const freshIntervals: OwnershipInterval[] = fresh.map((row) => ({
        roomId: row.roomId,
        userId: row.userId,
        start: row.startAt,
        end: row.endAt,
      }));
      if (isOwnerAt(freshIntervals, input.roomId, targetUserId, now)) {
        throw new AppError('VALIDATION_ERROR', 'The user already owns this room.');
      }
      const created = await insertOwnership(tx, {
        roomId: input.roomId,
        userId: targetUserId,
        startAt: now,
        grantedBy: actor.userId,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'ownership.granted',
        resourceType: 'room_ownership',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: {
          roomId: input.roomId,
          userId: targetUserId,
          startAt: created.startAt.toISOString(),
        },
      });
      if (input.idempotencyKey !== undefined) {
        await upsertIdempotencyRecord(tx, {
          scope: 'CO_OWNER_GRANT',
          key: input.idempotencyKey,
          actorId: actor.userId,
          requestHash,
          resultRefType: 'room_ownership',
          resultRefId: created.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
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

export async function resolveGrantTargetByUsername(
  username: string,
  conn: Db = db,
): Promise<{ userId: string } | null> {
  const found = await findUserByUsername(conn, username.trim().toLowerCase());
  return found === null ? null : { userId: found.id };
}
