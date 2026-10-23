import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { validatePassword, type PasswordViolation } from '../domain/passwordPolicy';
import { createTxInternalAdapter } from '../infrastructure/txAdapter';
import { deleteUserSessions, findUserById } from '../infrastructure/userRepository';
import { emitRevokeFanOut } from '../infrastructure/revokeFanOut';
import type { IdentityCtx } from './ctx';

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResult {
  userId: string;
  firstLoginCleared: boolean;
  revokedSessions: number;
}

function passwordMessage(violation: PasswordViolation): string {
  if (violation === 'PASSWORD_TOO_SHORT') return 'Password must be at least 12 characters.';
  if (violation === 'PASSWORD_TOO_LONG') return 'Password is too long.';
  if (violation === 'PASSWORD_EQUALS_USERNAME') return 'Password must not equal the username.';
  if (violation === 'PASSWORD_EQUALS_TEMP') return 'Password must differ from the temporary password.';
  return 'Password is too common.';
}

export async function changePassword(
  actor: Actor,
  input: ChangePasswordInput,
  ctx: IdentityCtx,
): Promise<ChangePasswordResult> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  const outcome = await db.transaction(async (tx) => {
    const target = await findUserById(tx, actor.userId);
    if (target === null) throw new AppError('AUTH_REQUIRED');
    if (target.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
    const authCtx = await createTxInternalAdapter(tx);
    const credential = await authCtx.adapter.findCredentialAccount(actor.userId);
    if (credential === null || typeof credential.password !== 'string') {
      throw new AppError('INTERNAL_ERROR');
    }
    const matches = await authCtx.verifyPassword(credential.password, input.currentPassword);
    if (!matches) throw new AppError('VALIDATION_ERROR', 'The current password is incorrect.');
    const violation = validatePassword({
      password: input.newPassword,
      username: target.username ?? '',
    });
    if (violation !== null) {
      throw new AppError('VALIDATION_ERROR', undefined, {
        fieldErrors: { newPassword: [passwordMessage(violation)] },
      });
    }
    const hash = await authCtx.hashPassword(input.newPassword);
    await authCtx.adapter.updatePassword(actor.userId, hash);
    const firstLoginCleared = target.mustChangePassword;
    await authCtx.adapter.updateUser(actor.userId, { mustChangePassword: false });
    const revokedSessions = await deleteUserSessions(tx, actor.userId);
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'user.password.changed',
      resourceType: 'user',
      resourceId: actor.userId,
      requestId: ctx.requestId,
      before: { mustChangePassword: target.mustChangePassword },
      after: { mustChangePassword: false, revokedSessions },
    });
    return { firstLoginCleared, revokedSessions };
  });
  emitRevokeFanOut({ userId: actor.userId, reason: 'PASSWORD_CHANGE' });
  return { userId: actor.userId, firstLoginCleared: outcome.firstLoginCleared, revokedSessions: outcome.revokedSessions };
}
