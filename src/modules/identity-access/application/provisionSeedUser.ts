import 'server-only';
import type { Actor, AccountStatus } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { normalizeEmail, normalizePhone, normalizeUsername, validateUsername } from '../domain/username';
import { createTxInternalAdapter } from '../infrastructure/txAdapter';
import { findUserByEmail, findUserByUsername } from '../infrastructure/userRepository';
import type { IdentityCtx } from './ctx';

export interface SeedUserInput {
  username: string;
  email: string;
  name: string;
  phone?: string | undefined;
  isSystemAdmin?: boolean | undefined;
  initialFlags?: {
    mustChangePassword?: boolean | undefined;
    accountStatus?: AccountStatus | undefined;
  } | undefined;
}

export interface SeedUserResult {
  userId: string;
  tempPassword: string;
}

export async function provisionSeedUser(
  actor: Actor,
  input: SeedUserInput,
  ctx: IdentityCtx,
): Promise<SeedUserResult> {
  if (!ctx.isSeedActor) throw new AppError('ACCESS_DENIED');
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  const normalizedUsername = normalizeUsername(input.username);
  const violation = validateUsername(normalizedUsername);
  if (violation !== null) throw new AppError('VALIDATION_ERROR', 'The seed username is invalid.');
  const normalizedEmail = normalizeEmail(input.email);
  const tempPassword = ctx.tempPasswords.generate();
  const mustChangePassword = input.initialFlags?.mustChangePassword ?? true;
  const accountStatus = input.initialFlags?.accountStatus ?? 'ACTIVE';
  const created = await db.transaction(async (tx) => {
    const byUsername = await findUserByUsername(tx, normalizedUsername);
    if (byUsername !== null) throw new AppError('VALIDATION_ERROR', 'Seed username already exists.');
    const byEmail = await findUserByEmail(tx, normalizedEmail);
    if (byEmail !== null) throw new AppError('VALIDATION_ERROR', 'Seed email already exists.');
    const authCtx = await createTxInternalAdapter(tx);
    const user = await authCtx.adapter.createUser(
      {
        name: input.name,
        email: normalizedEmail,
        username: normalizedUsername,
        phone: input.phone === undefined ? undefined : normalizePhone(input.phone),
        accountStatus,
        mustChangePassword,
        isSystemAdmin: input.isSystemAdmin ?? false,
      },
      { method: 'seed' },
    );
    if (user === null) throw new AppError('INTERNAL_ERROR');
    const hash = await authCtx.hashPassword(tempPassword);
    await authCtx.adapter.linkAccount({
      providerId: 'credential',
      accountId: user.id,
      userId: user.id,
      password: hash,
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'user.seed.provisioned',
      resourceType: 'user',
      resourceId: user.id,
      requestId: ctx.requestId,
      after: {
        username: normalizedUsername,
        accountStatus,
        mustChangePassword,
        isSystemAdmin: input.isSystemAdmin ?? false,
      },
    });
    return user;
  });
  return { userId: created.id, tempPassword };
}
