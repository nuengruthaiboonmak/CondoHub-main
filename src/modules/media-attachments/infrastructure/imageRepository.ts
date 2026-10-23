import 'server-only';
import { and, eq, gt, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import { imageAttachment } from './schema';
import type { ImageState } from '../domain/imageState';
import type { ImageScope } from '@/shared/storage/objectKeys';

export interface ImageAttachmentRecord {
  id: string;
  uploadedBy: string;
  objectKey: string;
  scope: ImageScope;
  mime: string;
  mimeVerified: boolean;
  sizeBytes: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  state: ImageState;
  ownerEntityType: string | null;
  ownerEntityId: string | null;
  attachedAt: Date | null;
  rejectReason: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

function toRecord(row: typeof imageAttachment.$inferSelect): ImageAttachmentRecord {
  return {
    id: row.id,
    uploadedBy: row.uploadedBy,
    objectKey: row.objectKey,
    scope: row.scope,
    mime: row.mime,
    mimeVerified: row.mimeVerified,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    state: row.state,
    ownerEntityType: row.ownerEntityType,
    ownerEntityId: row.ownerEntityId,
    attachedAt: row.attachedAt,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export async function findImageById(db: Db, id: string): Promise<ImageAttachmentRecord | null> {
  const rows = await db.select().from(imageAttachment).where(eq(imageAttachment.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function insertImageIntent(
  tx: Tx,
  input: {
    uploadedBy: string;
    objectKey: string;
    scope: ImageScope;
    mime: string;
    expiresAt: Date;
  },
): Promise<ImageAttachmentRecord> {
  const rows = await tx
    .insert(imageAttachment)
    .values({
      uploadedBy: input.uploadedBy,
      objectKey: input.objectKey,
      scope: input.scope,
      mime: input.mime,
      expiresAt: input.expiresAt,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Image intent insert returned no row.');
  return toRecord(row);
}

export async function insertSeedImage(
  tx: Tx,
  input: {
    uploadedBy: string;
    objectKey: string;
    scope: ImageScope;
    mime: string;
    createdAt: Date;
    expiresAt: Date | null;
  },
): Promise<ImageAttachmentRecord> {
  const rows = await tx
    .insert(imageAttachment)
    .values({
      uploadedBy: input.uploadedBy,
      objectKey: input.objectKey,
      scope: input.scope,
      mime: input.mime,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Seed image insert returned no row.');
  return toRecord(row);
}

export async function markImageReady(
  tx: Tx,
  id: string,
  input: {
    objectKey: string;
    sizeBytes: number;
    mimeVerified: string;
    width: number | null;
    height: number | null;
    sha256: string | null;
  },
): Promise<ImageAttachmentRecord | null> {
  const rows = await tx
    .update(imageAttachment)
    .set({
      state: 'READY',
      objectKey: input.objectKey,
      sizeBytes: input.sizeBytes,
      mime: input.mimeVerified,
      mimeVerified: true,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
      expiresAt: null,
    })
    .where(and(eq(imageAttachment.id, id), eq(imageAttachment.state, 'PENDING')))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function markImageRejected(
  tx: Tx,
  id: string,
  rejectReason: string,
): Promise<ImageAttachmentRecord | null> {
  const rows = await tx
    .update(imageAttachment)
    .set({ state: 'REJECTED', rejectReason, expiresAt: null })
    .where(and(eq(imageAttachment.id, id), eq(imageAttachment.state, 'PENDING')))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function listImagesByIdsForUpdate(
  tx: Tx,
  ids: string[],
): Promise<ImageAttachmentRecord[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select()
    .from(imageAttachment)
    .where(inArray(imageAttachment.id, [...ids].sort()))
    .for('update');
  return rows.map(toRecord);
}

export async function attachImages(
  tx: Tx,
  ids: string[],
  owner: { type: string; id: string },
  attachedAt: Date,
): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(imageAttachment)
    .set({ ownerEntityType: owner.type, ownerEntityId: owner.id, attachedAt })
    .where(inArray(imageAttachment.id, ids));
}

export async function detachImages(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(imageAttachment)
    .set({ ownerEntityType: null, ownerEntityId: null, attachedAt: null })
    .where(inArray(imageAttachment.id, ids));
}

export async function listAttachedImages(
  db: Db,
  owner: { type: string; id: string },
): Promise<ImageAttachmentRecord[]> {
  const rows = await db
    .select()
    .from(imageAttachment)
    .where(
      and(
        eq(imageAttachment.ownerEntityType, owner.type),
        eq(imageAttachment.ownerEntityId, owner.id),
        eq(imageAttachment.state, 'READY'),
      ),
    )
    .orderBy(imageAttachment.attachedAt, imageAttachment.id);
  return rows.map(toRecord);
}

export async function countUserOpenIntents(
  db: Db,
  input: { uploadedBy: string; scope: ImageScope; now: Date },
): Promise<number> {
  const rows = await db
    .select({ id: imageAttachment.id })
    .from(imageAttachment)
    .where(
      and(
        eq(imageAttachment.uploadedBy, input.uploadedBy),
        eq(imageAttachment.scope, input.scope),
        eq(imageAttachment.state, 'PENDING'),
        isNotNull(imageAttachment.expiresAt),
        gt(imageAttachment.expiresAt, input.now),
      ),
    );
  return rows.length;
}

export async function listAnnouncementImages(
  db: Db,
  announcementId: string,
): Promise<ImageAttachmentRecord[]> {
  return listAttachedImages(db, { type: 'announcement', id: announcementId });
}

export async function listOrphanSweepCandidates(
  db: Db,
  input: { pendingBefore: Date; readyBefore: Date; limit: number },
): Promise<ImageAttachmentRecord[]> {
  const rows = await db
    .select()
    .from(imageAttachment)
    .where(
      and(
        isNull(imageAttachment.ownerEntityType),
        or(
          and(
            inArray(imageAttachment.state, ['PENDING', 'UPLOADED']),
            lt(imageAttachment.createdAt, input.pendingBefore),
          ),
          and(
            eq(imageAttachment.state, 'READY'),
            lt(imageAttachment.createdAt, input.readyBefore),
          ),
        ),
      ),
    )
    .orderBy(imageAttachment.createdAt)
    .limit(input.limit);
  return rows.map(toRecord);
}

export async function markImageOrphaned(
  tx: Tx,
  id: string,
  input: { pendingBefore: Date; readyBefore: Date; reason: string },
): Promise<boolean> {
  const rows = await tx
    .update(imageAttachment)
    .set({ state: 'ORPHANED', rejectReason: input.reason, expiresAt: null })
    .where(
      and(
        eq(imageAttachment.id, id),
        isNull(imageAttachment.ownerEntityType),
        or(
          and(
            inArray(imageAttachment.state, ['PENDING', 'UPLOADED']),
            lt(imageAttachment.createdAt, input.pendingBefore),
          ),
          and(
            eq(imageAttachment.state, 'READY'),
            lt(imageAttachment.createdAt, input.readyBefore),
          ),
        ),
      ),
    )
    .returning({ id: imageAttachment.id });
  return rows.length > 0;
}
