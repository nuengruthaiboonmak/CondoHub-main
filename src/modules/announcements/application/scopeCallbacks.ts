import 'server-only';
import { db } from '@/shared/db/client';
import type { Actor } from '@/shared/auth/actor';
import type {
  ScopeAclCallback,
  ScopeAclImage,
  ScopeAclVerdict,
} from '@/modules/media-attachments/domain/scopeAcl';
import { registerScopeAcl } from '@/modules/media-attachments/application/index';
import { canSeeAnnouncement } from '../domain/announcementPolicy';
import { findAnnouncementById } from '../infrastructure/announcementRepository';

export const announcementScopeAcl: ScopeAclCallback = async (
  actor: Actor,
  image: ScopeAclImage,
  at: Date,
): Promise<ScopeAclVerdict> => {
  if (actor.accountStatus !== 'ACTIVE') return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
  if (actor.mustChangePassword) return { allowed: false, reason: 'FIRST_LOGIN_REQUIRED' };
  if (image.entityRef === null) {
    return actor.isSystemAdmin ? { allowed: true } : { allowed: false, reason: 'ADMIN_ONLY' };
  }
  if (image.entityRef.type !== 'announcement') return { allowed: false, reason: 'ADMIN_ONLY' };
  const announcement = await findAnnouncementById(db, image.entityRef.id);
  if (announcement === null) return { allowed: false, reason: 'ANNOUNCEMENT_HIDDEN' };
  const verdict = canSeeAnnouncement(
    actor,
    { publishAt: announcement.publishAt, hiddenAt: announcement.hiddenAt },
    'IMAGE',
    at,
  );
  if (!verdict.allowed) return verdict;
  return { allowed: true };
};

export const denyClosedScopeAcl: ScopeAclCallback = async (): Promise<ScopeAclVerdict> => {
  return { allowed: false, reason: 'SCOPE_ACL_NOT_IMPLEMENTED' };
};

export function wireAnnouncementScopeAcl(): void {
  registerScopeAcl('ANNOUNCEMENT', announcementScopeAcl);
  registerScopeAcl('PAYMENT_SLIP', denyClosedScopeAcl);
  registerScopeAcl('PAYMENT_QR', denyClosedScopeAcl);
  registerScopeAcl('MAINTENANCE', denyClosedScopeAcl);
  registerScopeAcl('CHAT', denyClosedScopeAcl);
}
