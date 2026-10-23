import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { getRoomLabels, resolveActorRooms } from '@/modules/property-membership/application/index';
import {
  cancelChargeEvent,
  findChargeEventById,
  listEventInvoiceRoomIds,
  lockChargeEvent,
  markChargeEventIssued,
  setChargeEventContext,
} from '../infrastructure/billingRepository';
import { readChargeEventRoomScope } from '../domain/chargeEventContext';
import { generateOneTimeEventInvoices } from './generateInvoices';
import type { BillingCtx } from './ctx';

function assertAdmin(actor: Actor): void {
  if (!actor.isSystemAdmin || actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

export async function getEventIssuanceRooms(actor: Actor, at: Date) {
  assertAdmin(actor);
  const rooms = (await resolveActorRooms(actor, at)).filter((room) => room.status === 'ACTIVE');
  const labels = new Map(
    (await getRoomLabels(rooms.map((room) => room.id))).map((room) => [room.id, room.label]),
  );
  return rooms
    .map((room) => ({ id: room.id, label: labels.get(room.id) ?? room.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function issueCommonFeeEvent(
  actor: Actor,
  eventId: string,
  input: { roomIds?: string[] | undefined },
  ctx: BillingCtx,
) {
  assertAdmin(actor);
  const now = ctx.clock.now();
  const activeRooms = (await resolveActorRooms(actor, now)).filter(
    (room) => room.status === 'ACTIVE',
  );
  const requested = input.roomIds === undefined ? null : [...new Set(input.roomIds)];
  if (
    requested &&
    (!requested.length || requested.some((id) => !activeRooms.some((room) => room.id === id)))
  )
    throw new AppError(
      'VALIDATION_ERROR',
      'Choose active rooms that are still available, then try again.',
    );
  const scope = await db.transaction(async (tx) => {
    const event = await lockChargeEvent(tx, eventId);
    if (!event) throw new AppError('RESOURCE_NOT_FOUND');
    if (event.status === 'CANCELLED')
      throw new AppError('VALIDATION_ERROR', 'This event was cancelled and cannot issue invoices.');
    const stored = readChargeEventRoomScope(event.chargeContext);
    if (event.status === 'ISSUED') return stored ?? (await listEventInvoiceRoomIds(tx, eventId));
    if (stored) {
      if (
        requested &&
        (stored.length !== requested.length || requested.some((id) => !stored.includes(id)))
      )
        throw new AppError(
          'VALIDATION_ERROR',
          'The event audience is already fixed. Reload to continue its remaining invoices.',
        );
      return stored;
    }
    const issued = await listEventInvoiceRoomIds(tx, eventId);
    if (issued.length && requested)
      throw new AppError(
        'VALIDATION_ERROR',
        'This event already has invoices for the project. Continue the existing audience.',
      );
    const ids = requested ?? activeRooms.map((room) => room.id);
    if (!ids.length)
      throw new AppError('VALIDATION_ERROR', 'Add or reactivate a room before issuing invoices.');
    if (event.status === 'OPEN') {
      const context =
        event.chargeContext &&
        typeof event.chargeContext === 'object' &&
        !Array.isArray(event.chargeContext)
          ? (event.chargeContext as Record<string, unknown>)
          : {};
      await setChargeEventContext(tx, eventId, { ...context, roomIds: ids });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'common_fee_event.audience_confirmed',
        resourceType: 'common_fee_charge_event',
        resourceId: eventId,
        requestId: ctx.requestId,
        after: { roomCount: ids.length },
      });
    }
    return ids;
  });
  const billed = new Set(await listEventInvoiceRoomIds(db, eventId));
  const targets = activeRooms.filter((room) => scope.includes(room.id));
  const batch = targets
    .filter((room) => !billed.has(room.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 25);
  const counts = await generateOneTimeEventInvoices(actor, eventId, ctx, {
    rooms: batch,
    finalizeEvent: false,
  });
  const after = new Set(await listEventInvoiceRoomIds(db, eventId));
  const remaining = targets.filter((room) => !after.has(room.id)).length;
  if (remaining === 0 && counts.cycleErrors.length === 0) {
    await db.transaction(async (tx) => {
      await lockChargeEvent(tx, eventId);
      await markChargeEventIssued(tx, eventId);
    });
  }
  const current = await findChargeEventById(db, eventId);
  return {
    created: counts.created,
    skipped: counts.skipped,
    remaining,
    issued: after.size,
    status: current?.status ?? 'OPEN',
    errors: counts.cycleErrors,
  };
}

export async function cancelCommonFeeEvent(actor: Actor, eventId: string, ctx: BillingCtx) {
  assertAdmin(actor);
  return db.transaction(async (tx) => {
    const event = await lockChargeEvent(tx, eventId);
    if (!event) throw new AppError('RESOURCE_NOT_FOUND');
    if (event.status !== 'OPEN')
      throw new AppError(
        'VALIDATION_ERROR',
        'Only an open event can be cancelled. Issued invoices stay recorded.',
      );
    await cancelChargeEvent(tx, eventId);
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'common_fee_event.cancelled',
      resourceType: 'common_fee_charge_event',
      resourceId: eventId,
      requestId: ctx.requestId,
      after: { status: 'CANCELLED' },
    });
    return { id: eventId, status: 'CANCELLED' as const };
  });
}
