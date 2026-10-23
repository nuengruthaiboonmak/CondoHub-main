import 'server-only';
import { asc, eq } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import { maintenanceComment } from './schema';

export interface TicketCommentRecord {
  id: string;
  requestId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

function toRecord(row: typeof maintenanceComment.$inferSelect): TicketCommentRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt,
  };
}

export async function insertTicketComment(
  tx: Tx,
  input: { requestId: string; authorId: string; body: string },
): Promise<TicketCommentRecord> {
  const rows = await tx
    .insert(maintenanceComment)
    .values({ requestId: input.requestId, authorId: input.authorId, body: input.body })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('The comment insert returned no row.');
  return toRecord(row);
}

export async function listTicketComments(
  conn: Db,
  requestId: string,
): Promise<TicketCommentRecord[]> {
  const rows = await conn
    .select()
    .from(maintenanceComment)
    .where(eq(maintenanceComment.requestId, requestId))
    .orderBy(asc(maintenanceComment.createdAt), asc(maintenanceComment.id));
  return rows.map(toRecord);
}

export async function findTicketCommentById(
  conn: Db,
  id: string,
): Promise<TicketCommentRecord | null> {
  const rows = await conn
    .select()
    .from(maintenanceComment)
    .where(eq(maintenanceComment.id, id))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}
