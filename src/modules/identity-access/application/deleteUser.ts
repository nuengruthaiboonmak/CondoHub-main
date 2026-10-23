import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import {
  deleteUserCredentials,
  deleteUserSessions,
  lockUserById,
  markUserDeleted,
} from '../infrastructure/userRepository';
import { emitRevokeFanOut } from '../infrastructure/revokeFanOut';
import type { IdentityCtx } from './ctx';
import { lockCurrentLifecycleAdministrator } from './lifecycleAuthorization';
import { assertAccountResponsibilitiesClosed } from './accountResponsibilities';

export async function deleteUser(actor: Actor, userId: string, ctx: IdentityCtx) {
  if (!actor.isSystemAdmin || actor.accountStatus !== 'ACTIVE' || actor.userId === userId)
    throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const now = ctx.clock.now();
  const outcome = await db.transaction(async (tx) => {
    await lockCurrentLifecycleAdministrator(tx, actor.userId);
    const target = await lockUserById(tx, userId);
    if (!target || target.deletedAt !== null) throw new AppError('RESOURCE_NOT_FOUND');
    await assertAccountResponsibilitiesClosed(tx, userId, now);
    await markUserDeleted(tx, userId, now);
    await deleteUserCredentials(tx, userId);
    const revokedSessions = await deleteUserSessions(tx, userId);
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'user.deleted',
      resourceType: 'user',
      resourceId: userId,
      requestId: ctx.requestId,
      before: { accountStatus: target.accountStatus },
      after: { deletedAt: now.toISOString(), revokedSessions },
    });
    return { userId, revokedSessions };
  });
  emitRevokeFanOut({ userId, reason: 'SUSPEND' });
  return outcome;
}
