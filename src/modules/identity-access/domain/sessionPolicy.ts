import type { Actor } from '@/shared/auth/actor';

export type SessionGateOutcome = 'ALLOW' | 'SUSPENDED' | 'FIRST_LOGIN';

export function evaluateSessionGate(actor: Actor): SessionGateOutcome {
  if (actor.accountStatus !== 'ACTIVE') return 'SUSPENDED';
  if (actor.mustChangePassword) return 'FIRST_LOGIN';
  return 'ALLOW';
}

export function isRevocationEvent(event: 'PASSWORD_CHANGE' | 'PASSWORD_RESET' | 'SUSPEND'): boolean {
  return event === 'PASSWORD_CHANGE' || event === 'PASSWORD_RESET' || event === 'SUSPEND';
}

export function requiresFullLogout(event: 'PASSWORD_CHANGE' | 'PASSWORD_RESET' | 'SUSPEND'): boolean {
  return isRevocationEvent(event);
}
