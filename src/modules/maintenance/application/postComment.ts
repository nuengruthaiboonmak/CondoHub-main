import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { hashRequestBody } from '@/shared/utils/idempotency';
import { writeAudit } from '@/shared/observability/audit';
import { IMAGE_COUNT_CAPS } from '@/config/imageLimits';
import { commitAttachments, listAttachedImagesForEntity } from '@/modules/media-attachments/application/index';
import { assertCommentBodyValid, assertCommentTargetOpen, decideTicketAction } from '../domain/commentPolicy';
import {
  findTicketById,
  lockTicketForUpdate,
  type TicketRecord,
} from '../infrastructure/ticketRepository';
import { findTicketCommentById, insertTicketComment } from '../infrastructure/commentRepository';
import { buildTicketGrants, type TicketCommentDto } from './ticketReads';
import {
  getTicketIdempotencyRecord,
  upsertTicketIdempotencyRecord,
} from './ticketIdempotency';
import type { MaintenanceCtx } from './ctx';

export interface PostCommentInput {
  body: string;
  imageIds?: string[] | undefined;
  idempotencyKey?: string | undefined;
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

async function replayComment(
  conn: Db,
  actor: Actor,
  ticketId: string,
  key: string,
  requestHash: string,
): Promise<TicketCommentDto> {
  const existing = await getTicketIdempotencyRecord(conn, { scope: 'TICKET_COMMENT', key });
  if (existing === null) throw new AppError('RATE_LIMITED');
  if (existing.requestHash !== requestHash) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The Idempotency-Key was already used with a different request.',
    );
  }
  if (existing.resultRefId === null) throw new AppError('RATE_LIMITED');
  const comment = await findTicketCommentById(conn, existing.resultRefId);
  if (comment === null || comment.requestId !== ticketId) throw new AppError('RATE_LIMITED');
  const row: TicketRecord | null = await findTicketById(conn, ticketId);
  if (row === null) throw new AppError('RESOURCE_NOT_FOUND');
  const grants = await buildTicketGrants(conn, actor, row);
  decideTicketAction(grants, { routingKind: row.routingKind, status: row.status }, 'COMMENT');
  const images = await listAttachedImagesForEntity(conn, { type: 'maintenance_comment', id: comment.id });
  return {
    id: comment.id,
    authorId: comment.authorId,
    body: comment.body,
    images: images.map((image) => ({
      id: image.id,
      byteSize: image.sizeBytes,
      mime: image.mime,
      width: image.width,
      height: image.height,
    })),
    createdAt: comment.createdAt.toISOString(),
  };
}

export async function postTicketComment(
  actor: Actor,
  ticketId: string,
  input: PostCommentInput,
  ctx: MaintenanceCtx,
  conn: Db = db,
): Promise<TicketCommentDto> {
  assertActive(actor);
  const trimmed = assertCommentBodyValid(input.body);
  const imageIds = input.imageIds ?? [];
  const now = ctx.clock.now();
  const row: TicketRecord | null = await findTicketById(conn, ticketId);
  if (row === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (actor.isSystemAdmin && row.routingKind === 'PRIVATE_OWNER') {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  const requestHash = hashRequestBody({
    ticketId,
    body: trimmed,
    imageIds: [...imageIds].sort(),
  });
  if (input.idempotencyKey !== undefined) {
    const existing = await getTicketIdempotencyRecord(conn, {
      scope: 'TICKET_COMMENT',
      key: input.idempotencyKey,
    });
    if (existing !== null) {
      return replayComment(conn, actor, ticketId, input.idempotencyKey, requestHash);
    }
  }
  try {
    return await conn.transaction(async (tx) => {
      const locked = await lockTicketForUpdate(tx, ticketId);
      if (locked === null) throw new AppError('RESOURCE_NOT_FOUND');
      const grants = await buildTicketGrants(tx, actor, locked);
      decideTicketAction(
        grants,
        { routingKind: locked.routingKind, status: locked.status },
        'COMMENT',
      );
      assertCommentTargetOpen(locked.status);
      const created = await insertTicketComment(tx, {
        requestId: locked.id,
        authorId: actor.userId,
        body: trimmed,
      });
      await commitAttachments(tx, actor, {
        scope: 'MAINTENANCE',
        entityRef: { type: 'maintenance_comment', id: created.id },
        imageIds,
        maxCount: IMAGE_COUNT_CAPS.ADD_TICKET_COMMENT.max,
        at: now,
      });
      const attached = await listAttachedImagesForEntity(tx, {
        type: 'maintenance_comment',
        id: created.id,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'maintenance_ticket.commented',
        resourceType: 'maintenance_comment',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { ticketId: locked.id, imageCount: attached.length },
        at: now,
      });
      if (input.idempotencyKey !== undefined) {
        await upsertTicketIdempotencyRecord(tx, {
          scope: 'TICKET_COMMENT',
          key: input.idempotencyKey,
          actorId: actor.userId,
          requestHash,
          resultRefType: 'maintenance_comment',
          resultRefId: created.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
      }
      return {
        id: created.id,
        authorId: created.authorId,
        body: created.body,
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
      fallbackCodes: {
        '23503': 'VALIDATION_ERROR',
      },
    });
  }
}
