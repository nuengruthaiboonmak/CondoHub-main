import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { createTxInternalAdapter } from '../infrastructure/txAdapter';
import { deleteUserSessions, lockUserById } from '../infrastructure/userRepository';
import { emitRevokeFanOut } from '../infrastructure/revokeFanOut';
import type { IdentityCtx } from './ctx';

export interface ResetPasswordResult {
  userId: string;
  tempPassword: string;
  revokedSessions: number;
}

export async function resetPassword(
  actor: Actor,
  userId: string,
  ctx: IdentityCtx,
): Promise<ResetPasswordResult> {
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  if (actor.userId === userId) throw new AppError('ACCESS_DENIED');
  const tempPassword = ctx.tempPasswords.generate();
  const outcome = await db.transaction(async (tx) => {
    const target = await lockUserById(tx, userId);
    if (target === null || target.deletedAt !== null) throw new AppError('RESOURCE_NOT_FOUND');
    const authCtx = await createTxInternalAdapter(tx);
    const hash = await authCtx.hashPassword(tempPassword);
    await authCtx.adapter.updatePassword(userId, hash);
    await authCtx.adapter.updateUser(userId, { mustChangePassword: true });
    const revokedSessions = await deleteUserSessions(tx, userId);
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'user.password.reset',
      resourceType: 'user',
      resourceId: userId,
      requestId: ctx.requestId,
      after: { revokedSessions, mustChangePassword: true },
    });
    return { revokedSessions };
  });
  emitRevokeFanOut({ userId, reason: 'RESET' });
  return { userId, tempPassword, revokedSessions: outcome.revokedSessions };
}
