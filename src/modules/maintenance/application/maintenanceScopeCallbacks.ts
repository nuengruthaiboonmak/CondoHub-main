import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import type {
  ScopeAclCallback,
  ScopeAclImage,
  ScopeAclVerdict,
} from '@/modules/media-attachments/domain/scopeAcl';
import { registerScopeAcl } from '@/modules/media-attachments/application/index';
import { db } from '@/shared/db/client';
import { evaluateTicketAccess } from '../domain/ticketPolicy';
import { findTicketById, isTicketRecipient } from '../infrastructure/ticketRepository';
import { findTicketCommentById } from '../infrastructure/commentRepository';

async function decideForTicket(
  actor: Actor,
  ticketId: string,
): Promise<ScopeAclVerdict> {
  if (actor.accountStatus !== 'ACTIVE') return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
  if (actor.mustChangePassword) return { allowed: false, reason: 'FIRST_LOGIN_REQUIRED' };
  const row = await findTicketById(db, ticketId);
  if (row === null) return { allowed: false, reason: 'NO_CURRENT_ACCESS' };
  if (row.routingKind === 'PRIVATE_OWNER' && actor.isSystemAdmin) {
    return { allowed: false, reason: 'NO_CURRENT_ACCESS' };
  }
  const recipient =
    row.routingKind === 'PRIVATE_OWNER' && !actor.isSystemAdmin
      ? await isTicketRecipient(db, { ticketId: row.id, userId: actor.userId })
      : false;
  const verdict = evaluateTicketAccess(
    {
      actorIsSystemAdmin: actor.isSystemAdmin,
      actorSuspended: false,
      actorMustChangePassword: false,
      actorIsReporter: row.reporterId === actor.userId,
      actorInRecipientSnapshot: recipient,
    },
    { routingKind: row.routingKind, status: row.status },
    'VIEW_IMAGE',
  );
  return verdict.allowed ? { allowed: true } : { allowed: false, reason: 'NO_CURRENT_ACCESS' };
}

export const maintenanceScopeAcl: ScopeAclCallback = async (
  actor: Actor,
  image: ScopeAclImage,
  at: Date,
): Promise<ScopeAclVerdict> => {
  void at;
  if (actor.accountStatus !== 'ACTIVE') return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
  if (actor.mustChangePassword) return { allowed: false, reason: 'FIRST_LOGIN_REQUIRED' };
  if (image.entityRef === null) return { allowed: true };
  if (image.entityRef.type === 'maintenance_request') {
    return decideForTicket(actor, image.entityRef.id);
  }
  if (image.entityRef.type === 'maintenance_comment') {
    const comment = await findTicketCommentById(db, image.entityRef.id);
    if (comment === null) return { allowed: false, reason: 'NO_CURRENT_ACCESS' };
    return decideForTicket(actor, comment.requestId);
  }
  return { allowed: false, reason: 'NO_CURRENT_ACCESS' };
};

export function wireMaintenanceScopeAcl(): void {
  registerScopeAcl('MAINTENANCE', maintenanceScopeAcl);
}
