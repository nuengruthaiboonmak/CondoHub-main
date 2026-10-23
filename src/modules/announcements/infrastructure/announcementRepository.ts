import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import { announcement, announcementRevision } from './schema';

export interface AnnouncementRecord {
  id: string;
  authorId: string | null;
  title: string;
  body: string;
  publishAt: Date | null;
  hiddenAt: Date | null;
  editedAt: Date | null;
  revision: number;
}

function toRecord(row: typeof announcement.$inferSelect): AnnouncementRecord {
  return {
    id: row.id,
    authorId: row.authorId,
    title: row.title,
    body: row.body,
    publishAt: row.publishAt,
    hiddenAt: row.hiddenAt,
    editedAt: row.editedAt,
    revision: row.revision,
  };
}

export interface AnnouncementRevisionRecord {
  id: string;
  announcementId: string;
  actorId: string | null;
  version: number;
  snapshotJson: unknown;
  createdAt: Date;
}

function toRevisionRecord(
  row: typeof announcementRevision.$inferSelect,
): AnnouncementRevisionRecord {
  return {
    id: row.id,
    announcementId: row.announcementId,
    actorId: row.actorId,
    version: row.version,
    snapshotJson: row.snapshotJson,
    createdAt: row.createdAt,
  };
}

export async function findAnnouncementById(db: Db, id: string): Promise<AnnouncementRecord | null> {
  const rows = await db
    .select()
    .from(announcement)
    .where(and(eq(announcement.id, id), isNull(announcement.deletedAt)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function findAnnouncementByIdForUpdate(
  tx: Tx,
  id: string,
): Promise<AnnouncementRecord | null> {
  const rows = await tx
    .select()
    .from(announcement)
    .where(and(eq(announcement.id, id), isNull(announcement.deletedAt)))
    .limit(1)
    .for('update');
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function listAllAnnouncements(db: Db): Promise<AnnouncementRecord[]> {
  const rows = await db
    .select()
    .from(announcement)
    .where(isNull(announcement.deletedAt))
    .orderBy(desc(announcement.publishAt), desc(announcement.id));
  return rows.map(toRecord);
}

export async function insertAnnouncement(
  tx: Tx,
  input: { authorId: string | null; title: string; body: string; publishAt: Date | null },
): Promise<AnnouncementRecord> {
  const rows = await tx
    .insert(announcement)
    .values({
      authorId: input.authorId,
      title: input.title,
      body: input.body,
      publishAt: input.publishAt,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Announcement insert returned no row.');
  return toRecord(row);
}

export async function updateAnnouncement(
  tx: Tx,
  id: string,
  input: {
    title?: string | undefined;
    body?: string | undefined;
    publishAt?: Date | null | undefined;
    hiddenAt?: Date | null | undefined;
    editedAt?: Date | null | undefined;
    revision?: number | undefined;
  },
): Promise<AnnouncementRecord | null> {
  const rows = await tx
    .update(announcement)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.publishAt !== undefined ? { publishAt: input.publishAt } : {}),
      ...(input.hiddenAt !== undefined ? { hiddenAt: input.hiddenAt } : {}),
      ...(input.editedAt !== undefined ? { editedAt: input.editedAt } : {}),
      ...(input.revision !== undefined ? { revision: input.revision } : {}),
    })
    .where(eq(announcement.id, id))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function insertAnnouncementRevision(
  tx: Tx,
  input: {
    announcementId: string;
    actorId: string | null;
    version: number;
    snapshotJson: Record<string, unknown>;
  },
): Promise<AnnouncementRevisionRecord> {
  const rows = await tx
    .insert(announcementRevision)
    .values({
      announcementId: input.announcementId,
      actorId: input.actorId,
      version: input.version,
      snapshotJson: input.snapshotJson,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Announcement revision insert returned no row.');
  return toRevisionRecord(row);
}

export async function listAnnouncementRevisions(
  db: Db,
  announcementId: string,
): Promise<AnnouncementRevisionRecord[]> {
  const rows = await db
    .select()
    .from(announcementRevision)
    .where(eq(announcementRevision.announcementId, announcementId))
    .orderBy(desc(announcementRevision.version));
  return rows.map(toRevisionRecord);
}

export async function markAnnouncementDeleted(tx: Tx, id: string, now: Date): Promise<void> {
  await tx
    .update(announcement)
    .set({ deletedAt: now, hiddenAt: now })
    .where(eq(announcement.id, id));
}
