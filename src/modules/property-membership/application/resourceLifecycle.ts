import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import {
  lockPropertyScope,
  listRoomDeletionBlockers,
  markPropertyScopeDeleted,
  type PropertyResourceKind,
} from '../infrastructure/structureRepository';
import type { PropertyCtx } from './ctx';

export async function deletePropertyResource(
  actor: Actor,
  kind: PropertyResourceKind,
  id: string,
  ctx: PropertyCtx,
) {
  if (!actor.isSystemAdmin || actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const now = ctx.clock.now();
  try {
    return await db.transaction(async (tx) => {
      const scope = await lockPropertyScope(tx, kind, id);
      if (!scope) throw new AppError('RESOURCE_NOT_FOUND');
      const blockedIds = await listRoomDeletionBlockers(
        tx,
        scope.rooms.map((entry) => entry.id),
        now,
      );
      if (blockedIds.length > 0) {
        const names = scope.rooms
          .filter((entry) => blockedIds.includes(entry.id))
          .slice(0, 5)
          .map((entry) => entry.name || entry.roomCode);
        throw new AppError(
          'VALIDATION_ERROR',
          `End active or scheduled rentals and room memberships before deleting. Rooms: ${names.join(', ')}${blockedIds.length > 5 ? ' and others' : ''}.`,
        );
      }
      await markPropertyScopeDeleted(tx, kind, id, scope, now);
      await writeAudit(tx, {
        actorId: actor.userId,
        action: `${kind}.deleted`,
        resourceType: kind,
        resourceId: id,
        requestId: ctx.requestId,
        after: {
          deletedAt: now.toISOString(),
          rooms: scope.rooms.length,
          floors: kind === 'room' ? 0 : scope.floors.length,
        },
      });
      return {
        id,
        deletedRooms: scope.rooms.length,
        deletedFloors: kind === 'room' ? 0 : scope.floors.length,
      };
    });
  } catch (error) {
    throw mapPgError(error);
  }
}
