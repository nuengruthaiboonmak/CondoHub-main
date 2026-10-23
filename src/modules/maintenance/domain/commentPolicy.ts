import { AppError } from '@/shared/utils/errors';
import type { MaintenanceStatus } from '../infrastructure/schema';
import { isTerminalStatus } from './stateMachine';
import {
  evaluateTicketAccess,
  type TicketActorGrants,
  type TicketResourceState,
} from './ticketPolicy';

export function assertCommentTargetOpen(status: MaintenanceStatus): void {
  if (isTerminalStatus(status)) {
    throw new AppError('VALIDATION_ERROR', 'The ticket is closed and accepts no new comments.');
  }
}

export function assertCommentBodyValid(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The comment body is required.');
  }
  return trimmed;
}

export function decideTicketAction(
  grants: TicketActorGrants,
  resource: TicketResourceState,
  action: 'VIEW' | 'COMMENT' | 'VIEW_IMAGE' | 'TRANSITION_HANDLER',
): void {
  const verdict = evaluateTicketAccess(grants, resource, action);
  if (!verdict.allowed) {
    if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
    throw new AppError('RESOURCE_NOT_FOUND');
  }
}

export function decideTicketTransition(
  grants: TicketActorGrants,
  resource: TicketResourceState,
  toStatus: MaintenanceStatus,
): void {
  const verdict = evaluateTicketAccess(grants, resource, 'TRANSITION_TO', {
    toStatus,
  });
  if (!verdict.allowed) {
    if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
    throw new AppError('RESOURCE_NOT_FOUND');
  }
}
