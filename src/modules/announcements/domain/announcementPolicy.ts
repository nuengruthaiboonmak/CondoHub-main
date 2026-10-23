import type { Actor } from '@/shared/auth/actor';
import { deriveAnnouncementStatus, type AnnouncementTimestamps } from './visibility';

export type AnnouncementScope = 'FEED' | 'DETAIL' | 'IMAGE' | 'ARCHIVE';

export type AnnouncementDenyReason =
  | 'ACCOUNT_SUSPENDED'
  | 'FIRST_LOGIN_REQUIRED'
  | 'NOT_PUBLISHED'
  | 'ANNOUNCEMENT_HIDDEN'
  | 'ADMIN_ONLY';

export interface AnnouncementVerdict {
  allowed: boolean;
  reason?: AnnouncementDenyReason | undefined;
}

export function canSeeAnnouncement(
  actor: Actor,
  announcement: AnnouncementTimestamps,
  scope: AnnouncementScope,
  now: Date,
): AnnouncementVerdict {
  if (actor.accountStatus !== 'ACTIVE') return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
  if (actor.mustChangePassword) return { allowed: false, reason: 'FIRST_LOGIN_REQUIRED' };
  const status = deriveAnnouncementStatus(announcement, now);
  if (scope === 'ARCHIVE') {
    return actor.isSystemAdmin ? { allowed: true } : { allowed: false, reason: 'ADMIN_ONLY' };
  }
  if (status === 'HIDDEN') {
    if (actor.isSystemAdmin && (scope === 'DETAIL' || scope === 'IMAGE')) return { allowed: true };
    return { allowed: false, reason: 'ANNOUNCEMENT_HIDDEN' };
  }
  if (status !== 'PUBLISHED') {
    if (actor.isSystemAdmin) return { allowed: true };
    return { allowed: false, reason: 'NOT_PUBLISHED' };
  }
  return { allowed: true };
}
