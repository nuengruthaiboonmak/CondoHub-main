import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import type { Tx } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { systemClock } from '@/shared/utils/clock';
import { covers } from '../domain/intervals';
import { isOwnerAt, type OwnershipInterval } from '../domain/ownershipPolicy';
import { activeTenancyAt, type TenancyInterval } from '../domain/tenancyPolicy';
import {
  type ProvisionTargetRole,
  type RoomEntitlement,
} from '@/modules/identity-access/domain/provisioningPolicy';
import {
  getRoomProvisioningPorts,
  setRoomProvisioningPorts,
} from '@/modules/identity-access/application/roomProvisioningPorts';
import { findRoomById } from '../infrastructure/structureRepository';
import { db } from '@/shared/db/client';
import { listOwnershipsByRoom } from '../infrastructure/ownershipRepository';
import { listTenanciesByRoom } from '../infrastructure/tenancyRepository';
import { listMembershipsByRoom } from '../infrastructure/membershipRepository';
import { attachProvisionedMembership } from './memberships';

export async function resolveRoomEntitlement(
  actor: Actor,
  roomId: string,
): Promise<RoomEntitlement | null> {
  const room = await findRoomById(db, roomId);
  if (room === null) return null;
  const now = systemClock.now();
  const [ownerships, tenancies, memberships] = await Promise.all([
    listOwnershipsByRoom(db, roomId),
    listTenanciesByRoom(db, roomId),
    listMembershipsByRoom(db, roomId),
  ]);
  const ownershipIntervals: OwnershipInterval[] = ownerships.map((row) => ({
    roomId: row.roomId,
    userId: row.userId,
    start: row.startAt,
    end: row.endAt,
  }));
  const tenancyIntervals: TenancyInterval[] = tenancies.map((row) => ({
    roomId: row.roomId,
    state: row.state,
    start: row.startsAt,
    end: row.endsAt,
  }));
  const active = activeTenancyAt(tenancyIntervals, roomId, now);
  const activeRow = tenancies.find(
    (row) => row.state === 'ACTIVE' && covers({ start: row.startsAt, end: row.endsAt }, now),
  );
  const managementMode = active === null ? 'PRIVATE_OWNER_MANAGED' : (activeRow?.managementMode ?? 'PRIVATE_OWNER_MANAGED');
  const isTopTenantManager = memberships.some(
    (membership) =>
      membership.userId === actor.userId &&
      membership.memberRole === 'MAIN' &&
      covers({ start: membership.startAt, end: membership.endAt }, now),
  );
  return {
    roomId,
    managementMode,
    isCurrentOwner: isOwnerAt(ownershipIntervals, roomId, actor.userId, now),
    isTopTenantManager,
  };
}

export async function attachRoomMembership(
  tx: Tx,
  input: { roomId: string; userId: string; targetRole: ProvisionTargetRole },
): Promise<{ membershipId: string }> {
  const room = await findRoomById(tx, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  const now = systemClock.now();
  if (input.targetRole === 'CO_OWNER') {
    const { insertOwnership } = await import('../infrastructure/ownershipRepository');
    const created = await insertOwnership(tx, {
      roomId: input.roomId,
      userId: input.userId,
      startAt: now,
      grantedBy: null,
    });
    return { membershipId: created.id };
  }
  return attachProvisionedMembership(tx, {
    roomId: input.roomId,
    userId: input.userId,
    memberRole: 'SUB',
    requestId: `provision-${input.roomId}`,
    actorId: null,
    at: now,
  });
}

export function wireRoomProvisioningPorts(): void {
  try {
    getRoomProvisioningPorts();
    return;
  } catch {
    setRoomProvisioningPorts({
      resolveEntitlement: resolveRoomEntitlement,
      attachMembership: attachRoomMembership,
    });
  }
}
