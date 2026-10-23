import 'server-only';
import { AppError } from '@/shared/utils/errors';
import type { Actor } from './actor';

export function requireActor(actor: Actor | null): Actor {
  if (actor === null) throw new AppError('AUTH_REQUIRED');
  return actor;
}

export function requireActiveActor(actor: Actor | null): Actor {
  const resolved = requireActor(actor);
  if (resolved.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  assertNoFirstLogin(resolved);
  return resolved;
}

export function requireAdmin(actor: Actor | null): Actor {
  const resolved = requireActiveActor(actor);
  if (!resolved.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  return resolved;
}

export function assertNoFirstLogin(actor: Actor): void {
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}
