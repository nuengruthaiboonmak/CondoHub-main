import 'server-only';
import type { Tx } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import type { UsernameViolation } from '../domain/username';
import { normalizeEmail, normalizePhone, normalizeUsername, validateUsername } from '../domain/username';
import { createTxInternalAdapter } from '../infrastructure/txAdapter';
import { findUserByEmail, findUserByUsername } from '../infrastructure/userRepository';
import type { IdentityCtx } from './ctx';

export interface GrantUserInput {
  username?: string | undefined;
  email: string;
  name: string;
  phone?: string | undefined;
  isSystemAdmin?: boolean | undefined;
}

export type GrantUserResult =
  | { created: true; userId: string; tempPassword: string }
  | { created: false; userId: string };

function usernameMessage(violation: UsernameViolation): string {
  if (violation === 'USERNAME_TOO_SHORT') return 'Username is too short.';
  if (violation === 'USERNAME_TOO_LONG') return 'Username is too long.';
  return 'Username may only contain lowercase letters, digits, dots, and underscores.';
}

export async function resolveOrCreateGrantUser(
  tx: Tx,
  input: GrantUserInput,
  ctx: IdentityCtx,
): Promise<GrantUserResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedUsername = input.username === undefined ? null : normalizeUsername(input.username);
  if (normalizedUsername !== null) {
    const violation = validateUsername(normalizedUsername);
    if (violation !== null) {
      throw new AppError('VALIDATION_ERROR', undefined, {
        fieldErrors: { username: [usernameMessage(violation)] },
      });
    }
  }
  const byUsername =
    normalizedUsername === null ? null : await findUserByUsername(tx, normalizedUsername);
  if (byUsername !== null) return { created: false, userId: byUsername.id };
  const byEmail = await findUserByEmail(tx, normalizedEmail);
  if (byEmail !== null) return { created: false, userId: byEmail.id };
  if (normalizedUsername === null) {
    throw new AppError('VALIDATION_ERROR', undefined, {
      fieldErrors: { username: ['Username is required for a new account.'] },
    });
  }
  const authCtx = await createTxInternalAdapter(tx);
  const tempPassword = ctx.tempPasswords.generate();
  const created = await authCtx.adapter.createUser(
    {
      name: input.name,
      email: normalizedEmail,
      username: normalizedUsername,
      phone: input.phone === undefined ? undefined : normalizePhone(input.phone),
      accountStatus: 'ACTIVE',
      mustChangePassword: true,
      isSystemAdmin: input.isSystemAdmin ?? false,
    },
    { method: 'admin' },
  );
  if (created === null) throw new AppError('INTERNAL_ERROR');
  const hash = await authCtx.hashPassword(tempPassword);
  await authCtx.adapter.linkAccount({
    providerId: 'credential',
    accountId: created.id,
    userId: created.id,
    password: hash,
  });
  return { created: true, userId: created.id, tempPassword };
}
