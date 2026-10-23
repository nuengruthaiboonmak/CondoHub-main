import { AppError } from '@/shared/utils/errors';
import type { MaintenanceStatus } from '../infrastructure/schema';

export type TicketStatus = MaintenanceStatus;

export const TICKET_OPEN_STATUSES: readonly TicketStatus[] = [
  'PENDING',
  'IN_PROGRESS',
  'WAITING_FOR_INFO',
];

export const TICKET_TERMINAL_STATUSES: readonly TicketStatus[] = [
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
];

export function isTerminalStatus(status: TicketStatus): boolean {
  return (TICKET_TERMINAL_STATUSES as readonly string[]).includes(status);
}

const HANDLER_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  PENDING: ['IN_PROGRESS', 'WAITING_FOR_INFO', 'COMPLETED', 'REJECTED', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_FOR_INFO', 'COMPLETED', 'REJECTED', 'CANCELLED'],
  WAITING_FOR_INFO: ['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function handlerTransitionsFrom(from: TicketStatus): readonly TicketStatus[] {
  return HANDLER_TRANSITIONS[from];
}

export function isHandlerTransitionAllowed(from: TicketStatus, to: TicketStatus): boolean {
  return (HANDLER_TRANSITIONS[from] as readonly string[]).includes(to);
}

export const REPORTER_CANCELLABLE_STATUSES: readonly TicketStatus[] = [
  'PENDING',
  'WAITING_FOR_INFO',
];

export function isReporterCancellable(from: TicketStatus, to: TicketStatus): boolean {
  return to === 'CANCELLED' && (REPORTER_CANCELLABLE_STATUSES as readonly string[]).includes(from);
}

export function assertTransitionAllowed(from: TicketStatus, to: TicketStatus): void {
  if (from === to) {
    throw new AppError('VALIDATION_ERROR', 'The ticket is already in the requested status.');
  }
  if (isTerminalStatus(from)) {
    throw new AppError('VALIDATION_ERROR', 'The ticket is closed and cannot change status.');
  }
  if (!isHandlerTransitionAllowed(from, to)) {
    throw new AppError('VALIDATION_ERROR', 'The requested status transition is not allowed.');
  }
}
