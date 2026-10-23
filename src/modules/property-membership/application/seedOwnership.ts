import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { findUserById } from '@/modules/identity-access/infrastructure/userRepository';
import { findRoomById } from '../infrastructure/structureRepository';
import { insertOwnership } from '../infrastructure/ownershipRepository';
import type { PropertyCtx } from './ctx';

export async function seedOwnership(
  actor: Actor,
  input: { roomId: string; userId: string; startAt: Date },
  ctx: PropertyCtx,
): Promise<{ ownershipId: string }> {
  if (!ctx.isSeedActor) throw new AppError('ACCESS_DENIED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  const room = await findRoomById(db, input.roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  const target = await findUserById(db, input.userId);
  if (target === null) throw new AppError('VALIDATION_ERROR', 'The seed owner was not found.');
  try {
    return await db.transaction(async (tx) => {
      const created = await insertOwnership(tx, {
        roomId: input.roomId,
        userId: input.userId,
        startAt: input.startAt,
        grantedBy: null,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'ownership.seed.created',
        resourceType: 'room_ownership',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { roomId: input.roomId, userId: input.userId, backdated: true },
      });
      return { ownershipId: created.id };
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { room_ownership_no_overlap_ex: 'VALIDATION_ERROR' },
      fallbackCodes: { '23P01': 'VALIDATION_ERROR' },
    });
  }
}
