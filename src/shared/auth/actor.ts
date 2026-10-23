import 'server-only';
import { headers } from 'next/headers';
import { auth } from '@/modules/identity-access/infrastructure/betterAuth';

export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface Actor {
  userId: string;
  isSystemAdmin: boolean;
  accountStatus: AccountStatus;
  mustChangePassword: boolean;
}

export interface SessionUser {
  id: string;
  accountStatus?: unknown;
  mustChangePassword?: unknown;
  isSystemAdmin?: unknown;
}

function parseAccountStatus(value: unknown): AccountStatus {
  return value === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
}

function parseIsSystemAdmin(value: unknown): boolean {
  return value === true;
}

export function buildActor(user: SessionUser, isSystemAdmin: boolean): Actor {
  return {
    userId: user.id,
    isSystemAdmin,
    accountStatus: parseAccountStatus(user.accountStatus),
    mustChangePassword: user.mustChangePassword === true,
  };
}

export async function getActorFromSession(): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session === null) return null;
  const user = session.user as SessionUser;
  return buildActor(user, parseIsSystemAdmin(user.isSystemAdmin));
}
