import 'server-only';
import type { Actor, AccountStatus } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { createTxInternalAdapter } from '../infrastructure/txAdapter';
import { deleteUserSessions, lockUserById } from '../infrastructure/userRepository';
import { emitRevokeFanOut } from '../infrastructure/revokeFanOut';
import type { IdentityCtx } from './ctx';
import { lockCurrentLifecycleAdministrator } from './lifecycleAuthorization';

export interface SetAccountStatusResult {
  userId: string;
  accountStatus: AccountStatus;
  revokedSessions: number;
}

export async function setAccountStatus(
  actor: Actor,
  userId: string,
  accountStatus: AccountStatus,
  ctx: IdentityCtx,
): Promise<SetAccountStatusResult> {
  if (!actor.isSystemAdmin || actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  if (actor.userId === userId) throw new AppError('ACCESS_DENIED');
  const outcome = await db.transaction(async (tx) => {
    await lockCurrentLifecycleAdministrator(tx, actor.userId);
    const target = await lockUserById(tx, userId);
    if (target === null || target.deletedAt !== null) throw new AppError('RESOURCE_NOT_FOUND');
    const authCtx = await createTxInternalAdapter(tx);
    await authCtx.adapter.updateUser(userId, { accountStatus });
    const revokedSessions =
      accountStatus === 'SUSPENDED' ? await deleteUserSessions(tx, userId) : 0;
    await writeAudit(tx, {
      actorId: actor.userId,
      action: accountStatus === 'SUSPENDED' ? 'user.suspended' : 'user.unsuspended',
      resourceType: 'user',
      resourceId: userId,
      requestId: ctx.requestId,
      before: { accountStatus: target.accountStatus },
      after: { accountStatus, revokedSessions },
    });
    return { revokedSessions };
  });
  if (accountStatus === 'SUSPENDED') emitRevokeFanOut({ userId, reason: 'SUSPEND' });
  return { userId, accountStatus, revokedSessions: outcome.revokedSessions };
}

export async function suspendUser(
  actor: Actor,
  userId: string,
  ctx: IdentityCtx,
): Promise<SetAccountStatusResult> {
  return setAccountStatus(actor, userId, 'SUSPENDED', ctx);
}

export async function unsuspendUser(
  actor: Actor,
  userId: string,
  ctx: IdentityCtx,
): Promise<SetAccountStatusResult> {
  return setAccountStatus(actor, userId, 'ACTIVE', ctx);
}
