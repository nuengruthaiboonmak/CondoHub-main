import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { requireAdmin } from '@/shared/auth/guards';
import { evaluateSessionGate } from '../domain/sessionPolicy';
import {
  deleteUserSessions,
  findUserById,
  listPeopleProfiles,
} from '../infrastructure/userRepository';
import { searchUsers, type UserSearchInput } from '../infrastructure/userRepository';

export async function searchUserAccounts(actor: Actor, input: UserSearchInput) {
  requireAdmin(actor);
  return searchUsers(db, {
    ...input,
    page: Math.max(1, Math.floor(input.page) || 1),
    pageSize: Math.min(100, Math.max(1, Math.floor(input.pageSize) || 20)),
  });
}

export async function getPeopleProfiles(ids: string[]) {
  return (await listPeopleProfiles(db, [...new Set(ids)])).map((person) => ({
    userId: person.userId,
    name: person.name,
    status: person.deletedAt
      ? ('DELETED' as const)
      : person.accountStatus === 'ACTIVE'
        ? ('ACTIVE' as const)
        : ('INACTIVE' as const),
  }));
}

export interface ActiveActor {
  userId: string;
  accountStatus: 'ACTIVE';
  mustChangePassword: false;
}

export async function requireActiveAccount(actorId: string): Promise<ActiveActor> {
  const target = await findUserById(db, actorId);
  if (target === null) throw new AppError('AUTH_REQUIRED');
  const candidate: Actor = {
    userId: target.id,
    isSystemAdmin: target.isSystemAdmin,
    accountStatus: target.accountStatus,
    mustChangePassword: target.mustChangePassword,
  };
  const outcome = evaluateSessionGate(candidate);
  if (outcome === 'SUSPENDED') throw new AppError('ACCESS_DENIED');
  if (outcome === 'FIRST_LOGIN') throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  return { userId: target.id, accountStatus: 'ACTIVE', mustChangePassword: false };
}

export async function isSystemAdmin(actorId: string): Promise<boolean> {
  const target = await findUserById(db, actorId);
  if (target === null) throw new AppError('AUTH_REQUIRED');
  return target.isSystemAdmin;
}

export interface SenderProfile {
  userId: string;
  name: string;
  isSystemAdmin: boolean;
}

export async function getSenderProfile(userId: string): Promise<SenderProfile> {
  const target = await findUserById(db, userId);
  if (target === null) throw new AppError('AUTH_REQUIRED');
  return { userId: target.id, name: target.name, isSystemAdmin: target.isSystemAdmin };
}

export async function revokeAllSessions(userId: string): Promise<{ revoked: number }> {
  const target = await findUserById(db, userId);
  if (target === null) throw new AppError('AUTH_REQUIRED');
  const revoked = await db.transaction(async (tx) => deleteUserSessions(tx, userId));
  return { revoked };
}
