import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Tx } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import {
  canProvisionInRoom,
  type ProvisionTargetRole,
  type RoomEntitlement,
} from '../domain/provisioningPolicy';
import { resolveOrCreateGrantUser } from './provisioning';
import type { IdentityCtx } from './ctx';

export interface ProvisionRoomUserInput {
  roomId: string;
  username?: string | undefined;
  email: string;
  name: string;
  phone?: string | undefined;
  targetRole: ProvisionTargetRole;
  idempotencyKey?: string | undefined;
}

export type ProvisionRoomUserResult =
  | { created: true; userId: string; tempPassword: string }
  | { created: false; userId: string };

export interface RoomEntitlementResolver {
  resolve(actor: Actor, roomId: string): Promise<RoomEntitlement | null>;
}

export interface MembershipAttacher {
  attach(tx: Tx, input: { roomId: string; userId: string; targetRole: ProvisionTargetRole }): Promise<{ membershipId: string }>;
}

export async function provisionUser(
  actor: Actor,
  input: ProvisionRoomUserInput,
  ctx: IdentityCtx,
  deps: { entitlements: RoomEntitlementResolver; memberships: MembershipAttacher },
): Promise<ProvisionRoomUserResult> {
  const entitlement = await deps.entitlements.resolve(actor, input.roomId);
  if (entitlement === null) throw new AppError('RESOURCE_NOT_FOUND');
  const verdict = canProvisionInRoom(actor, entitlement, input.targetRole);
  if (!verdict.allowed) throw new AppError('ACCESS_DENIED');
  return db.transaction(async (tx) => {
    const resolved = await resolveOrCreateGrantUser(
      tx,
      { username: input.username, email: input.email, name: input.name, phone: input.phone },
      ctx,
    );
    const attached = await deps.memberships.attach(tx, {
      roomId: input.roomId,
      userId: resolved.userId,
      targetRole: input.targetRole,
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      action: resolved.created ? 'user.provisioned' : 'user.attached',
      resourceType: 'user',
      resourceId: resolved.userId,
      requestId: ctx.requestId,
      after: { roomId: input.roomId, targetRole: input.targetRole, membershipId: attached.membershipId },
    });
    if (resolved.created) {
      return { created: true, userId: resolved.userId, tempPassword: resolved.tempPassword };
    }
    return { created: false, userId: resolved.userId };
  });
}
