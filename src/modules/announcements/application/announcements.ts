import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { IMAGE_COUNT_CAPS } from '@/config/imageLimits';
import { commitAttachments } from '@/modules/media-attachments/application/index';
import {
  detachImages,
  listAnnouncementImages,
} from '@/modules/media-attachments/infrastructure/imageRepository';
import { canSeeAnnouncement } from '../domain/announcementPolicy';
import { bumpRevision, snapshotAnnouncement } from '../domain/revisionPolicy';
import {
  insertAnnouncement,
  insertAnnouncementRevision,
  updateAnnouncement,
  findAnnouncementById,
  findAnnouncementByIdForUpdate,
  listAllAnnouncements,
  listAnnouncementRevisions,
  markAnnouncementDeleted,
} from '../infrastructure/announcementRepository';
import { sortFeedOrder } from '../domain/feedOrder';
import { deriveAnnouncementStatus } from '../domain/visibility';
import type { AnnouncementCtx } from './ctx';

export interface AnnouncementImageDto {
  id: string;
  byteSize: number;
  mime: string;
  width: number | null;
  height: number | null;
}

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  publishAt: string | null;
  hiddenAt: string | null;
  editedAt: string | null;
  revision: number;
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'HIDDEN';
  images: AnnouncementImageDto[];
  revisions: Array<{
    version: number;
    createdAt: string;
    snapshot: unknown;
  }>;
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  publishAt?: string | null | undefined;
  imageIds?: string[] | undefined;
}

function toImageDto(image: {
  id: string;
  sizeBytes: number;
  mime: string;
  width: number | null;
  height: number | null;
}): AnnouncementImageDto {
  return {
    id: image.id,
    byteSize: image.sizeBytes,
    mime: image.mime,
    width: image.width,
    height: image.height,
  };
}

export async function createAnnouncement(
  actor: Actor,
  input: CreateAnnouncementInput,
  ctx: AnnouncementCtx,
): Promise<AnnouncementDto> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  const publishAt =
    input.publishAt === undefined || input.publishAt === null ? null : new Date(input.publishAt);
  if (publishAt !== null && Number.isNaN(publishAt.getTime())) {
    throw new AppError('VALIDATION_ERROR', 'The publish date is invalid.');
  }
  const imageIds = input.imageIds ?? [];
  try {
    const created = await db.transaction(async (tx) => {
      const row = await insertAnnouncement(tx, {
        authorId: actor.userId,
        title: input.title,
        body: input.body,
        publishAt,
      });
      await commitAttachments(tx, actor, {
        scope: 'ANNOUNCEMENT',
        entityRef: { type: 'announcement', id: row.id },
        imageIds,
        maxCount: IMAGE_COUNT_CAPS.PUBLISH_ANNOUNCEMENT.max,
        at: ctx.clock.now(),
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'announcement.created',
        resourceType: 'announcement',
        resourceId: row.id,
        requestId: ctx.requestId,
        after: { title: row.title, publishAt: row.publishAt?.toISOString() ?? null },
      });
      return row;
    });
    const dto = await toAnnouncementDto(actor, created.id, ctx.clock.now());
    if (dto === null) throw new AppError('RESOURCE_NOT_FOUND');
    return dto;
  } catch (error) {
    throw mapPgError(error);
  }
}

export interface UpdateAnnouncementInput {
  title?: string | undefined;
  body?: string | undefined;
  publishAt?: string | null | undefined;
  hiddenAt?: string | null | undefined;
  imageIds?: string[] | undefined;
}

export async function updateAnnouncementEntry(
  actor: Actor,
  announcementId: string,
  input: UpdateAnnouncementInput,
  ctx: AnnouncementCtx,
): Promise<AnnouncementDto> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  const existing = await findAnnouncementById(db, announcementId);
  if (existing === null) throw new AppError('RESOURCE_NOT_FOUND');
  const now = ctx.clock.now();
  const patch = resolvePatch(input);
  const statusBefore = deriveAnnouncementStatus(existing, now);
  const publishedBefore = statusBefore === 'PUBLISHED' || statusBefore === 'HIDDEN';
  try {
    const updated = await db.transaction(async (tx) => {
      const locked = await findAnnouncementByIdForUpdate(tx, announcementId);
      if (locked === null) throw new AppError('RESOURCE_NOT_FOUND');
      if (input.imageIds !== undefined) {
        const current = await listAnnouncementImages(tx, announcementId);
        const currentIds = current.map((image) => image.id);
        const wanted = [...new Set(input.imageIds)];
        const toDetach = currentIds.filter((id) => !wanted.includes(id));
        const toAttach = wanted.filter((id) => !currentIds.includes(id));
        await detachImages(tx, toDetach);
        await commitAttachments(tx, actor, {
          scope: 'ANNOUNCEMENT',
          entityRef: { type: 'announcement', id: announcementId },
          imageIds: toAttach,
          maxCount:
            IMAGE_COUNT_CAPS.PUBLISH_ANNOUNCEMENT.max - (currentIds.length - toDetach.length),
          at: now,
        });
      }
      const bump = publishedBefore ? bumpRevision(existing.revision, now) : null;
      const revisionImages =
        input.imageIds === undefined
          ? (await listAnnouncementImages(tx, announcementId)).map((image) => image.id)
          : [...new Set(input.imageIds)];
      if (bump !== null) {
        await insertAnnouncementRevision(tx, {
          announcementId,
          actorId: actor.userId,
          version: bump.snapshotVersion,
          snapshotJson: snapshotAnnouncement({
            title: input.title ?? existing.title,
            body: input.body ?? existing.body,
            publishAt: patch.publishAt !== undefined ? patch.publishAt : existing.publishAt,
            imageIds: revisionImages,
            revision: bump.nextRevision,
          }),
        });
      }
      const next = await updateAnnouncement(tx, announcementId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(patch.publishAt !== undefined ? { publishAt: patch.publishAt } : {}),
        ...(patch.hiddenAt !== undefined ? { hiddenAt: patch.hiddenAt } : {}),
        ...(bump === null ? {} : { editedAt: bump.editedAt, revision: bump.nextRevision }),
      });
      if (next === null) throw new AppError('RESOURCE_NOT_FOUND');
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'announcement.updated',
        resourceType: 'announcement',
        resourceId: announcementId,
        requestId: ctx.requestId,
        before: { status: statusBefore },
        after: {
          title: next.title,
          publishAt: next.publishAt?.toISOString() ?? null,
          hiddenAt: next.hiddenAt?.toISOString() ?? null,
          revision: next.revision,
        },
      });
      return next;
    });
    const dto = await toAnnouncementDto(actor, updated.id, now);
    if (dto === null) throw new AppError('RESOURCE_NOT_FOUND');
    return dto;
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { announcement_revision_version_uq: 'VERSION_CONFLICT' },
      fallbackCodes: { '23505': 'VERSION_CONFLICT' },
    });
  }
}

function resolvePatch(input: UpdateAnnouncementInput): {
  publishAt?: Date | null | undefined;
  hiddenAt?: Date | null | undefined;
} {
  let publishAt: Date | null | undefined;
  if (input.publishAt !== undefined) {
    if (input.publishAt === null) {
      publishAt = null;
    } else {
      const parsed = new Date(input.publishAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError('VALIDATION_ERROR', 'The publish date is invalid.');
      }
      publishAt = parsed;
    }
  }
  let hiddenAt: Date | null | undefined;
  if (input.hiddenAt !== undefined) {
    if (input.hiddenAt === null) {
      hiddenAt = null;
    } else {
      const parsed = new Date(input.hiddenAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError('VALIDATION_ERROR', 'The hidden date is invalid.');
      }
      hiddenAt = parsed;
    }
  }
  return { publishAt, hiddenAt };
}

export async function getAnnouncementDetail(
  actor: Actor,
  announcementId: string,
  at: Date,
): Promise<AnnouncementDto | null> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const row = await findAnnouncementById(db, announcementId);
  if (row === null) return null;
  const verdict = canSeeAnnouncement(
    actor,
    { publishAt: row.publishAt, hiddenAt: row.hiddenAt },
    'DETAIL',
    at,
  );
  if (!verdict.allowed) return null;
  const dto = await toAnnouncementDto(actor, announcementId, at);
  if (!actor.isSystemAdmin && dto !== null) {
    return { ...dto, revisions: [] };
  }
  return dto;
}

export interface AnnouncementFeedPage {
  rows: AnnouncementDto[];
  total: number;
}

export async function listAnnouncementFeed(
  actor: Actor,
  input: { page: number; pageSize: number },
  at: Date,
): Promise<AnnouncementFeedPage> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const all = await listAllAnnouncements(db);
  const visible = all.filter((row) => canSeeAnnouncement(actor, row, 'FEED', at).allowed);
  const ordered = sortFeedOrder(
    visible.map((row) => ({
      ...row,
      publishAt: row.publishAt ?? new Date(0),
    })),
  );
  const total = ordered.length;
  const start = (input.page - 1) * input.pageSize;
  const page = ordered.slice(start, start + input.pageSize);
  const rows: AnnouncementDto[] = [];
  for (const row of page) {
    const dto = await toAnnouncementDto(actor, row.id, at);
    if (dto === null) continue;
    rows.push(actor.isSystemAdmin ? dto : { ...dto, revisions: [] });
  }
  return { rows, total };
}

export async function listAdminAnnouncements(
  actor: Actor,
  input: { page: number; pageSize: number },
  at: Date,
): Promise<AnnouncementFeedPage> {
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const all = await listAllAnnouncements(db);
  const ordered = sortFeedOrder(
    all.map((row) => ({ ...row, publishAt: row.publishAt ?? new Date(0) })),
  );
  const total = ordered.length;
  const start = (input.page - 1) * input.pageSize;
  const page = ordered.slice(start, start + input.pageSize);
  const rows: AnnouncementDto[] = [];
  for (const row of page) {
    const dto = await toAnnouncementDto(actor, row.id, at);
    if (dto === null) continue;
    rows.push(dto);
  }
  return { rows, total };
}

async function toAnnouncementDto(
  actor: Actor,
  announcementId: string,
  at: Date,
): Promise<AnnouncementDto | null> {
  const row = await findAnnouncementById(db, announcementId);
  if (row === null) return null;
  const images = await listAnnouncementImages(db, announcementId);
  const revisions = actor.isSystemAdmin ? await listAnnouncementRevisions(db, announcementId) : [];
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    publishAt: row.publishAt?.toISOString() ?? null,
    hiddenAt: row.hiddenAt?.toISOString() ?? null,
    editedAt: row.editedAt?.toISOString() ?? null,
    revision: row.revision,
    status: deriveAnnouncementStatus(row, at),
    images: images.map(toImageDto),
    revisions: revisions.map((revision) => ({
      version: revision.version,
      createdAt: revision.createdAt.toISOString(),
      snapshot: revision.snapshotJson,
    })),
  };
}

export async function deleteAnnouncement(actor: Actor, id: string, ctx: AnnouncementCtx) {
  if (!actor.isSystemAdmin || actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const now = ctx.clock.now();
  return db.transaction(async (tx) => {
    const target = await findAnnouncementByIdForUpdate(tx, id);
    if (!target) throw new AppError('RESOURCE_NOT_FOUND');
    await markAnnouncementDeleted(tx, id, now);
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'announcement.deleted',
      resourceType: 'announcement',
      resourceId: id,
      requestId: ctx.requestId,
      after: { deletedAt: now.toISOString() },
    });
    return { id };
  });
}
