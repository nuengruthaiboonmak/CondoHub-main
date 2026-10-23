import 'server-only';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import type { MemberRole } from './schema';
import { rentalPeriod, roomMembership } from './schema';

export interface MembershipRow {
  id: string;
  roomId: string;
  tenancyId: string | null;
  userId: string;
  memberRole: MemberRole;
  startAt: Date;
  endAt: Date | null;
}

function toMembershipRow(row: typeof roomMembership.$inferSelect): MembershipRow {
  return {
    id: row.id,
    roomId: row.roomId,
    tenancyId: row.tenancyId,
    userId: row.userId,
    memberRole: row.memberRole,
    startAt: row.startAt,
    endAt: row.endAt,
  };
}

export async function findMembershipById(db: Db, id: string): Promise<MembershipRow | null> {
  const rows = await db.select().from(roomMembership).where(eq(roomMembership.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toMembershipRow(row);
}

export async function listMembershipsByRoom(db: Db, roomId: string): Promise<MembershipRow[]> {
  const rows = await db
    .select()
    .from(roomMembership)
    .where(eq(roomMembership.roomId, roomId))
    .orderBy(roomMembership.startAt);
  return rows.map(toMembershipRow);
}

export async function listActiveMembershipsByRoom(
  db: Db,
  roomId: string,
): Promise<MembershipRow[]> {
  const rows = await db
    .select()
    .from(roomMembership)
    .where(
      and(
        eq(roomMembership.roomId, roomId),
        isNull(roomMembership.endAt),
        or(
          isNull(roomMembership.tenancyId),
          sql`exists (select 1 from ${rentalPeriod} where ${rentalPeriod.id} = ${roomMembership.tenancyId} and ${rentalPeriod.state} <> 'CANCELLED')`,
        ),
      ),
    )
    .orderBy(roomMembership.startAt);
  return rows.map(toMembershipRow);
}

export async function listMembershipsByUser(db: Db, userId: string): Promise<MembershipRow[]> {
  const rows = await db
    .select()
    .from(roomMembership)
    .where(
      and(
        eq(roomMembership.userId, userId),
        or(
          isNull(roomMembership.tenancyId),
          sql`exists (select 1 from ${rentalPeriod} where ${rentalPeriod.id} = ${roomMembership.tenancyId} and ${rentalPeriod.state} <> 'CANCELLED')`,
        ),
      ),
    )
    .orderBy(roomMembership.startAt);
  return rows.map(toMembershipRow);
}

export async function listMembershipsByTenancy(
  db: Db,
  tenancyId: string,
): Promise<MembershipRow[]> {
  const rows = await db
    .select()
    .from(roomMembership)
    .where(eq(roomMembership.tenancyId, tenancyId))
    .orderBy(roomMembership.startAt);
  return rows.map(toMembershipRow);
}

export async function insertMembership(
  tx: Tx,
  input: {
    roomId: string;
    tenancyId: string | null;
    userId: string;
    memberRole: MemberRole;
    startAt: Date;
  },
): Promise<MembershipRow> {
  const rows = await tx.insert(roomMembership).values(input).returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Membership insert returned no row.');
  return toMembershipRow(row);
}

export async function endMembership(
  tx: Tx,
  id: string,
  endAt: Date,
): Promise<MembershipRow | null> {
  const rows = await tx
    .update(roomMembership)
    .set({ endAt })
    .where(eq(roomMembership.id, id))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toMembershipRow(row);
}
