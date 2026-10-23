import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import type { MaintenanceStatus } from '../infrastructure/schema';
import { assertTransitionAllowed } from '../domain/stateMachine';
import { decideTicketTransition } from '../domain/commentPolicy';
import {
  findTicketById,
  lockTicketForUpdate,
  updateTicketStatus,
  type TicketRecord,
} from '../infrastructure/ticketRepository';
import { insertStatusHistory } from '../infrastructure/historyRepository';
import { buildTicketGrants } from './ticketReads';
import type { TicketDto } from './ticketReads';
import { toTicketDto } from './ticketReads';
import type { MaintenanceCtx } from './ctx';

export interface TransitionTicketInput {
  status: MaintenanceStatus;
  expectedVersion: number;
  reason?: string | undefined;
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

export async function transitionTicket(
  actor: Actor,
  ticketId: string,
  input: TransitionTicketInput,
  ctx: MaintenanceCtx,
  conn: Db = db,
): Promise<TicketDto> {
  assertActive(actor);
  const now = ctx.clock.now();
  const row: TicketRecord | null = await findTicketById(conn, ticketId);
  if (row === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (actor.isSystemAdmin && row.routingKind === 'PRIVATE_OWNER') {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  return conn.transaction(async (tx) => {
    const locked = await lockTicketForUpdate(tx, ticketId);
    if (locked === null) throw new AppError('RESOURCE_NOT_FOUND');
    if (locked.version !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');
    const grants = await buildTicketGrants(tx, actor, locked);
    decideTicketTransition(
      grants,
      { routingKind: locked.routingKind, status: locked.status },
      input.status,
    );
    assertTransitionAllowed(locked.status, input.status);
    const updated = await updateTicketStatus(tx, {
      id: locked.id,
      fromVersion: locked.version,
      toStatus: input.status,
      at: now,
    });
    if (updated === null) throw new AppError('VERSION_CONFLICT');
    await insertStatusHistory(tx, {
      requestId: locked.id,
      fromState: locked.status,
      toState: input.status,
      actorId: actor.userId,
      reason: input.reason ?? null,
      changedAt: now,
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'maintenance_ticket.transitioned',
      resourceType: 'maintenance_request',
      resourceId: locked.id,
      requestId: ctx.requestId,
      before: { status: locked.status, version: locked.version },
      after: {
        status: input.status,
        version: updated.version,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      },
      at: now,
    });
    const dto = await toTicketDto(tx, actor, locked.id);
    if (dto === null) throw new AppError('RESOURCE_NOT_FOUND');
    return dto;
  });
}
