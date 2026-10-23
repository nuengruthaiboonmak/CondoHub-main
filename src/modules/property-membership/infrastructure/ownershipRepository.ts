import 'server-only';
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import { roomOwnership } from './schema';

export async function listPrivateRentalManagerGroups(
  conn: Db,
  userId: string,
  at: Date,
): Promise<string[][]> {
  const result = await conn.execute<{ userIds: string[] }>(sql`
    select array_agg(distinct o.user_id) as "userIds"
    from room_ownership o
    where o.start_at <= ${at} and (o.end_at is null or o.end_at > ${at})
      and exists (select 1 from room_ownership target where target.room_id = o.room_id and target.user_id = ${userId} and target.start_at <= ${at} and (target.end_at is null or target.end_at > ${at}))
      and exists (select 1 from rental_period t where t.room_id = o.room_id and t.state = 'ACTIVE' and t.management_mode = 'PRIVATE_OWNER_MANAGED' and (t.ends_at is null or t.ends_at > ${at}))
    group by o.room_id
  `);
  return result.rows.map((row) => row.userIds);
}

export interface OwnershipRow {
  id: string;
  roomId: string;
  userId: string;
  startAt: Date;
  endAt: Date | null;
  grantedBy: string | null;
}

function toOwnershipRow(row: typeof roomOwnership.$inferSelect): OwnershipRow {
  return {
    id: row.id,
    roomId: row.roomId,
    userId: row.userId,
    startAt: row.startAt,
    endAt: row.endAt,
    grantedBy: row.grantedBy,
  };
}

export async function findOwnershipById(db: Db, id: string): Promise<OwnershipRow | null> {
  const rows = await db.select().from(roomOwnership).where(eq(roomOwnership.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toOwnershipRow(row);
}

export async function listOwnershipsByRoom(db: Db, roomId: string): Promise<OwnershipRow[]> {
  const rows = await db
    .select()
    .from(roomOwnership)
    .where(eq(roomOwnership.roomId, roomId))
    .orderBy(roomOwnership.startAt);
  return rows.map(toOwnershipRow);
}

export async function listActiveOwnershipsByRoom(
  db: Db,
  roomId: string,
  at: Date,
): Promise<OwnershipRow[]> {
  const rows = await db
    .select()
    .from(roomOwnership)
    .where(
      and(
        eq(roomOwnership.roomId, roomId),
        lte(roomOwnership.startAt, at),
        or(isNull(roomOwnership.endAt), gte(roomOwnership.endAt, at)),
      ),
    )
    .orderBy(roomOwnership.startAt);
  return rows
    .map(toOwnershipRow)
    .filter((row) => row.endAt === null || row.endAt.getTime() > at.getTime());
}

export async function listOwnershipIntervalsByUser(
  db: Db,
  userId: string,
): Promise<OwnershipRow[]> {
  const rows = await db
    .select()
    .from(roomOwnership)
    .where(eq(roomOwnership.userId, userId))
    .orderBy(roomOwnership.startAt);
  return rows.map(toOwnershipRow);
}

export async function insertOwnership(
  tx: Tx,
  input: { roomId: string; userId: string; startAt: Date; grantedBy: string | null },
): Promise<OwnershipRow> {
  const rows = await tx
    .insert(roomOwnership)
    .values({
      roomId: input.roomId,
      userId: input.userId,
      startAt: input.startAt,
      grantedBy: input.grantedBy,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Ownership insert returned no row.');
  return toOwnershipRow(row);
}

export async function endOwnership(tx: Tx, id: string, endAt: Date): Promise<OwnershipRow | null> {
  const rows = await tx
    .update(roomOwnership)
    .set({ endAt })
    .where(eq(roomOwnership.id, id))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toOwnershipRow(row);
}

export async function correctOwnership(
  tx: Tx,
  id: string,
  input: { startAt?: Date | undefined; endAt?: Date | null | undefined },
): Promise<OwnershipRow | null> {
  const rows = await tx
    .update(roomOwnership)
    .set({
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
    })
    .where(eq(roomOwnership.id, id))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toOwnershipRow(row);
}
