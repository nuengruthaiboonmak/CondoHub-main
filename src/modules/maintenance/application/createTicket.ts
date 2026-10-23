import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { hashRequestBody } from '@/shared/utils/idempotency';
import { writeAudit } from '@/shared/observability/audit';
import { IMAGE_COUNT_CAPS } from '@/config/imageLimits';
import { commitAttachments, listAttachedImagesForEntity } from '@/modules/media-attachments/application/index';
import {
  canActInRoom,
  getEligibleMaintenanceRooms,
  getOwnersAt,
  getRentalPeriods,
  listMembershipWindowsByUser,
} from '@/modules/property-membership/application/index';
import type {
  MaintenanceRoutingKind,
  MaintenanceStatus,
} from '../infrastructure/schema';
import {
  assertRecipientsPresent,
  assertRoutingSelectionValid,
  assertSelectedRoomEligible,
} from '../domain/ticketCreate';
import { insertTicket } from '../infrastructure/ticketRepository';
import { insertTicketRecipients } from '../infrastructure/ticketRepository';
import {
  getTicketIdempotencyRecord,
  upsertTicketIdempotencyRecord,
} from './ticketIdempotency';
import { assertTicketVisible, toTicketDto, type TicketImageDto } from './ticketReads';
import type { MaintenanceCtx } from './ctx';

export interface CreateTicketInput {
  routingKind: MaintenanceRoutingKind;
  roomId?: string | null | undefined;
  locationDescription: string;
  subject: string;
  description: string;
  imageIds?: string[] | undefined;
  idempotencyKey?: string | undefined;
}

export interface CreateTicketDto {
  id: string;
  routingKind: MaintenanceRoutingKind;
  roomId: string | null;
  locationDescription: string;
  subject: string;
  status: MaintenanceStatus;
  version: number;
  images: TicketImageDto[];
  createdAt: string;
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

function monthKeyFor(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function assertProjectManagedTenancy(
  actor: Actor,
  roomId: string,
  at: Date,
): Promise<void> {
  const periods = await getRentalPeriods(roomId, monthKeyFor(at));
  const pmTenancyIds = new Set(
    periods
      .filter(
        (period) =>
          period.managementMode === 'PROJECT_MANAGED' &&
          period.state === 'ACTIVE' &&
          period.startsAt.getTime() <= at.getTime() &&
          (period.endsAt === null || period.endsAt.getTime() > at.getTime()),
      )
      .map((period) => period.id),
  );
  if (pmTenancyIds.size === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The selected room is not eligible for this ticket.',
    );
  }
  const windows = await listMembershipWindowsByUser(actor.userId);
  const hasActiveWindow = windows.some(
    (window) =>
      window.roomId === roomId &&
      window.tenancyId !== null &&
      pmTenancyIds.has(window.tenancyId) &&
      window.start.getTime() <= at.getTime() &&
      (window.end === null || window.end.getTime() > at.getTime()),
  );
  if (!hasActiveWindow) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The selected room is not eligible for this ticket.',
    );
  }
}

async function assertOwnerManagedRoom(roomId: string, at: Date): Promise<void> {
  const periods = await getRentalPeriods(roomId, monthKeyFor(at));
  const projectManaged = periods.some(
    (period) =>
      period.managementMode === 'PROJECT_MANAGED' &&
      period.state === 'ACTIVE' &&
      period.startsAt.getTime() <= at.getTime() &&
      (period.endsAt === null || period.endsAt.getTime() > at.getTime()),
  );
  if (projectManaged) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The selected room is not eligible for this ticket.',
    );
  }
}

async function assertRoomEligibility(
  actor: Actor,
  routingKind: MaintenanceRoutingKind,
  roomId: string,
  at: Date,
): Promise<void> {
  const eligible = await getEligibleMaintenanceRooms(actor.userId, routingKind, at);
  assertSelectedRoomEligible({ roomId, eligibleRoomIds: eligible });
  const verdict = await canActInRoom(actor.userId, roomId, 'SUBMIT_MAINTENANCE', at).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    },
  );
  if (verdict === null || !verdict.allowed) {
    throw new AppError('VALIDATION_ERROR', 'The selected room is not eligible for this ticket.');
  }
  if (routingKind === 'PRIVATE_OWNER') {
    await assertOwnerManagedRoom(roomId, at);
    return;
  }
  await assertProjectManagedTenancy(actor, roomId, at);
}

async function replayCreate(
  conn: Db,
  actor: Actor,
  key: string,
  requestHash: string,
): Promise<CreateTicketDto> {
  const existing = await getTicketIdempotencyRecord(conn, { scope: 'TICKET_CREATE', key });
  if (existing === null) throw new AppError('RATE_LIMITED');
  if (existing.requestHash !== requestHash) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The Idempotency-Key was already used with a different request.',
    );
  }
  if (existing.resultRefId === null) throw new AppError('RATE_LIMITED');
  const dto = await toTicketDto(conn, actor, existing.resultRefId);
  if (dto === null) throw new AppError('RATE_LIMITED');
  return {
    id: dto.id,
    routingKind: dto.routingKind,
    roomId: dto.roomId,
    locationDescription: dto.locationDescription,
    subject: dto.subject,
    status: dto.status,
    version: dto.version,
    images: dto.images,
    createdAt: dto.createdAt,
  };
}

export async function createTicket(
  actor: Actor,
  input: CreateTicketInput,
  ctx: MaintenanceCtx,
  conn: Db = db,
): Promise<CreateTicketDto> {
  assertActive(actor);
  assertRoutingSelectionValid({ routingKind: input.routingKind, roomId: input.roomId });
  const now = ctx.clock.now();
  const imageIds = input.imageIds ?? [];
  const roomId = input.roomId ?? null;
  const requestHash = hashRequestBody({
    routingKind: input.routingKind,
    roomId,
    locationDescription: input.locationDescription,
    subject: input.subject,
    description: input.description,
    imageIds: [...imageIds].sort(),
  });
  if (input.idempotencyKey !== undefined) {
    const existing = await getTicketIdempotencyRecord(conn, {
      scope: 'TICKET_CREATE',
      key: input.idempotencyKey,
    });
    if (existing !== null) {
      return replayCreate(conn, actor, input.idempotencyKey, requestHash);
    }
  }
  if (roomId !== null) {
    await assertRoomEligibility(actor, input.routingKind, roomId, now);
  }
  try {
    return await conn.transaction(async (tx) => {
      if (roomId !== null) {
        await assertRoomEligibility(actor, input.routingKind, roomId, now);
      }
      let recipients: Array<{ userId: string; ownershipIntervalRef: string | null }> = [];
      if (input.routingKind === 'PRIVATE_OWNER' && roomId !== null) {
        const owners = await getOwnersAt(roomId, now);
        assertRecipientsPresent(owners.length);
        recipients = owners.map((owner) => ({
          userId: owner.userId,
          ownershipIntervalRef: owner.ownershipId,
        }));
      }
      const created = await insertTicket(tx, {
        reporterId: actor.userId,
        roomId,
        locationDescription: input.locationDescription,
        routingKind: input.routingKind,
        subject: input.subject,
        description: input.description,
        snapshotBoundaryAt: now,
      });
      await insertTicketRecipients(tx, {
        ticketId: created.id,
        recipients,
        assignedAt: now,
        assignedBy: actor.userId,
      });
      await commitAttachments(tx, actor, {
        scope: 'MAINTENANCE',
        entityRef: { type: 'maintenance_request', id: created.id },
        imageIds,
        maxCount: IMAGE_COUNT_CAPS.CREATE_TICKET.max,
        at: now,
      });
      const attached = await listAttachedImagesForEntity(tx, {
        type: 'maintenance_request',
        id: created.id,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'maintenance_ticket.created',
        resourceType: 'maintenance_request',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: {
          routingKind: created.routingKind,
          roomId: created.roomId,
          recipientCount: recipients.length,
          imageCount: attached.length,
        },
        at: now,
      });
      if (input.idempotencyKey !== undefined) {
        await upsertTicketIdempotencyRecord(tx, {
          scope: 'TICKET_CREATE',
          key: input.idempotencyKey,
          actorId: actor.userId,
          requestHash,
          resultRefType: 'maintenance_request',
          resultRefId: created.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
      }
      await assertTicketVisible(tx, actor, created);
      return {
        id: created.id,
        routingKind: created.routingKind,
        roomId: created.roomId,
        locationDescription: created.locationDescription,
        subject: created.subject,
        status: created.status,
        version: created.version,
        images: attached.map((image) => ({
          id: image.id,
          byteSize: image.sizeBytes,
          mime: image.mime,
          width: image.width,
          height: image.height,
        })),
        createdAt: created.createdAt.toISOString(),
      };
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: {
        maintenance_recipient_request_user_uq: 'INTERNAL_ERROR',
      },
      fallbackCodes: {
        '23503': 'VALIDATION_ERROR',
      },
    });
  }
}
