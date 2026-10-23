import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Tx } from '@/shared/db/transaction';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { covers } from '../domain/intervals';
import { isOwnerAt, type OwnershipInterval } from '../domain/ownershipPolicy';
import { activeTenancyAt, type TenancyInterval } from '../domain/tenancyPolicy';
import type { MemberRole } from '../infrastructure/schema';
import { findUserById } from '@/modules/identity-access/infrastructure/userRepository';
import {
  findRoomById,
  lockPropertyScope,
  isRoomOperational,
} from '../infrastructure/structureRepository';
import { listOwnershipsByRoom } from '../infrastructure/ownershipRepository';
import { lockTenancyById, listTenanciesByRoom } from '../infrastructure/tenancyRepository';
import {
  endMembership,
  findMembershipById,
  insertMembership,
  listMembershipsByRoom,
  type MembershipRow,
} from '../infrastructure/membershipRepository';
import type { PropertyCtx } from './ctx';

export interface AddMembershipInput {
  roomId: string;
  userId: string;
  memberRole: MemberRole;
  tenancyId?: string | null | undefined;
  effectiveAt?: Date | undefined;
}

function requireUsableActor(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

async function canManageMemberships(
  conn: Parameters<typeof listOwnershipsByRoom>[0],
  roomId: string,
  actor: Actor,
  at: Date,
): Promise<boolean> {
  if (actor.isSystemAdmin) return true;
  const ownerships = await listOwnershipsByRoom(conn, roomId);
  const intervals: OwnershipInterval[] = ownerships.map((row) => ({
    roomId: row.roomId,
    userId: row.userId,
    start: row.startAt,
    end: row.endAt,
  }));
  if (isOwnerAt(intervals, roomId, actor.userId, at)) return true;
  const memberships = await listMembershipsByRoom(conn, roomId);
  const tenancies = await listTenanciesByRoom(conn, roomId);
  return memberships.some(
    (membership) =>
      membership.userId === actor.userId &&
      membership.memberRole === 'MAIN' &&
      (membership.tenancyId === null ||
        tenancies.some((row) => row.id === membership.tenancyId && row.state !== 'CANCELLED')) &&
      covers({ start: membership.startAt, end: membership.endAt }, at),
  );
}

export async function addMembership(
  actor: Actor,
  input: AddMembershipInput,
  ctx: PropertyCtx,
): Promise<MembershipRow> {
  requireUsableActor(actor);
  if (input.effectiveAt !== undefined && !ctx.isSeedActor) {
    throw new AppError('VALIDATION_ERROR', 'The effective time is reserved for seed actors.');
  }
  const room = await findRoomById(db, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  try {
    return await db.transaction(async (tx) => {
      if (!(await lockPropertyScope(tx, 'room', input.roomId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      if (!ctx.isSeedActor && !(await isRoomOperational(tx, input.roomId)))
        throw new AppError(
          'VALIDATION_ERROR',
          'Reactivate the room, floor and building before adding members.',
        );
      const target = await findUserById(tx, input.userId);
      if (target === null) throw new AppError('VALIDATION_ERROR', 'The member user was not found.');
      if (target.accountStatus !== 'ACTIVE' || target.deletedAt !== null) {
        throw new AppError('VALIDATION_ERROR', 'The member user cannot receive membership.');
      }
      const now = ctx.clock.now();
      const startAt = input.effectiveAt ?? now;
      const tenancyId = input.tenancyId ?? null;
      if (tenancyId !== null) {
        const tenancy = await lockTenancyById(tx, tenancyId);
        if (tenancy === null || tenancy.roomId !== input.roomId) {
          throw new AppError('VALIDATION_ERROR', 'The tenancy does not belong to the room.');
        }
        if (tenancy.state !== 'ACTIVE') {
          throw new AppError('VALIDATION_ERROR', 'Members join only through an active tenancy.');
        }
      } else {
        const tenancies = await listTenanciesByRoom(tx, input.roomId);
        const intervals: TenancyInterval[] = tenancies.map((row) => ({
          roomId: row.roomId,
          state: row.state,
          start: row.startsAt,
          end: row.endsAt,
        }));
        if (activeTenancyAt(intervals, input.roomId, startAt) !== null) {
          throw new AppError('VALIDATION_ERROR', 'Members join through the active tenancy.');
        }
      }
      const manager = await canManageMemberships(tx, input.roomId, actor, now);
      if (!manager) throw new AppError('ACCESS_DENIED');
      const existingActive = await listMembershipsByRoom(tx, input.roomId);
      const duplicate = existingActive.some(
        (membership) =>
          membership.userId === input.userId &&
          membership.endAt === null &&
          (membership.tenancyId ?? null) === tenancyId,
      );
      if (duplicate) {
        throw new AppError('VALIDATION_ERROR', 'The user already holds an active membership.');
      }
      const created = await insertMembership(tx, {
        roomId: input.roomId,
        tenancyId,
        userId: input.userId,
        memberRole: input.memberRole,
        startAt,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'membership.added',
        resourceType: 'room_membership',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: {
          roomId: input.roomId,
          userId: input.userId,
          memberRole: input.memberRole,
          tenancyId,
          backdated: input.effectiveAt !== undefined,
        },
      });
      return created;
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: {
        room_membership_active_tenancy_puq: 'VALIDATION_ERROR',
        room_membership_active_direct_puq: 'VALIDATION_ERROR',
      },
    });
  }
}

export async function endMembershipAt(
  actor: Actor,
  input: { roomId: string; membershipId: string; endsAt?: Date | undefined },
  ctx: PropertyCtx,
): Promise<MembershipRow> {
  requireUsableActor(actor);
  const room = await findRoomById(db, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  const membership = await findMembershipById(db, input.membershipId);
  if (membership === null || membership.roomId !== input.roomId) {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  if (membership.endAt !== null) {
    throw new AppError('VALIDATION_ERROR', 'The membership is already ended.');
  }
  const now = ctx.clock.now();
  const endsAt = input.endsAt ?? now;
  if (endsAt.getTime() <= membership.startAt.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'The membership end must be after its start.');
  }
  const manager = await canManageMemberships(db, input.roomId, actor, now);
  if (!manager) throw new AppError('ACCESS_DENIED');
  try {
    return await db.transaction(async (tx) => {
      const ended = await endMembership(tx, membership.id, endsAt);
      if (ended === null) throw new AppError('RESOURCE_NOT_FOUND');
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'membership.ended',
        resourceType: 'room_membership',
        resourceId: membership.id,
        requestId: ctx.requestId,
        before: { userId: membership.userId, memberRole: membership.memberRole },
        after: { endsAt: endsAt.toISOString() },
      });
      return ended;
    });
  } catch (error) {
    throw mapPgError(error);
  }
}

export async function listRoomMemberships(roomId: string): Promise<MembershipRow[]> {
  const room = await findRoomById(db, roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  return listMembershipsByRoom(db, roomId);
}

export async function attachProvisionedMembership(
  tx: Tx,
  input: {
    roomId: string;
    userId: string;
    memberRole: MemberRole;
    requestId: string;
    actorId: string | null;
    at: Date;
  },
): Promise<{ membershipId: string }> {
  const tenancies = await listTenanciesByRoom(tx, input.roomId);
  const intervals: TenancyInterval[] = tenancies.map((row) => ({
    roomId: row.roomId,
    state: row.state,
    start: row.startsAt,
    end: row.endsAt,
  }));
  const active = activeTenancyAt(intervals, input.roomId, input.at);
  const activeRow = tenancies.find(
    (row) => row.state === 'ACTIVE' && covers({ start: row.startsAt, end: row.endsAt }, input.at),
  );
  const tenancyId = active === null ? null : (activeRow?.id ?? null);
  try {
    const created = await insertMembership(tx, {
      roomId: input.roomId,
      tenancyId,
      userId: input.userId,
      memberRole: input.memberRole,
      startAt: input.at,
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: 'membership.added',
      resourceType: 'room_membership',
      resourceId: created.id,
      requestId: input.requestId,
      after: {
        roomId: input.roomId,
        userId: input.userId,
        memberRole: input.memberRole,
        tenancyId,
      },
    });
    return { membershipId: created.id };
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: {
        room_membership_active_tenancy_puq: 'VALIDATION_ERROR',
        room_membership_active_direct_puq: 'VALIDATION_ERROR',
      },
    });
  }
}

export async function listCurrentRoomMemberships(
  roomId: string,
  at: Date,
): Promise<MembershipRow[]> {
  const [memberships, tenancies] = await Promise.all([
    listRoomMemberships(roomId),
    listTenanciesByRoom(db, roomId),
  ]);
  return memberships.filter(
    (entry) =>
      covers({ start: entry.startAt, end: entry.endAt }, at) &&
      (entry.tenancyId === null ||
        tenancies.some(
          (tenancy) =>
            tenancy.id === entry.tenancyId &&
            tenancy.state === 'ACTIVE' &&
            covers({ start: tenancy.startsAt, end: tenancy.endsAt }, at),
        )),
  );
}
