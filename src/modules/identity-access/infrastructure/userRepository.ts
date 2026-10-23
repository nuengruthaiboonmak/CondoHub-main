import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import type { AccountStatus } from '@/shared/auth/actor';
import { account, session, user } from './betterAuthSchema';

export async function listRetainedPrivateManagerIds(conn: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await conn
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.id, ids), isNull(user.deletedAt), eq(user.isSystemAdmin, false)));
  return rows.map((row) => row.id);
}

export async function listPeopleProfiles(conn: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return conn
    .select({
      userId: user.id,
      name: user.name,
      accountStatus: user.accountStatus,
      deletedAt: user.deletedAt,
    })
    .from(user)
    .where(inArray(user.id, ids));
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  username: string | null;
  phone: string | null;
  accountStatus: AccountStatus;
  mustChangePassword: boolean;
  isSystemAdmin: boolean;
  createdAt: Date;
  deletedAt: Date | null;
}

function toUserRow(row: typeof user.$inferSelect): UserRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username,
    phone: row.phone,
    accountStatus: row.accountStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
    mustChangePassword: row.mustChangePassword,
    isSystemAdmin: row.isSystemAdmin,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

export async function findUserById(db: Db, userId: string): Promise<UserRow | null> {
  const rows = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toUserRow(row);
}

export async function findUserByUsername(
  db: Db,
  normalizedUsername: string,
): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(user)
    .where(and(eq(user.username, normalizedUsername), isNull(user.deletedAt)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toUserRow(row);
}

export async function findUserByEmail(db: Db, normalizedEmail: string): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(user)
    .where(and(eq(user.email, normalizedEmail), isNull(user.deletedAt)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toUserRow(row);
}

export async function deleteUserSessions(tx: Tx, userId: string): Promise<number> {
  const deleted = await tx
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id });
  return deleted.length;
}

export async function countActiveSessions(db: Db, userId: string, now: Date): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(session)
    .where(eq(session.userId, userId));
  void now;
  const row = rows[0];
  return row === undefined ? 0 : row.count;
}

export interface UserSearchInput {
  query?: string | undefined;
  page: number;
  pageSize: number;
}

export interface UserSearchResult {
  rows: UserRow[];
  total: number;
}

export async function searchUsers(db: Db, input: UserSearchInput): Promise<UserSearchResult> {
  const pattern = input.query === undefined || input.query === '' ? null : `%${input.query}%`;
  const search =
    pattern === null
      ? undefined
      : sql`(${user.username} ILIKE ${pattern} OR ${user.email} ILIKE ${pattern} OR ${user.name} ILIKE ${pattern})`;
  const whereClause = and(isNull(user.deletedAt), search);
  const offset = (input.page - 1) * input.pageSize;
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(user)
      .where(whereClause)
      .orderBy(user.createdAt)
      .limit(input.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(user)
      .where(whereClause),
  ]);
  const totalRow = totals[0];
  return { rows: rows.map(toUserRow), total: totalRow === undefined ? 0 : totalRow.count };
}

export async function lockUserById(tx: Tx, id: string): Promise<UserRow | null> {
  const rows = await tx.select().from(user).where(eq(user.id, id)).for('update').limit(1);
  return rows[0] ? toUserRow(rows[0]) : null;
}

export async function lockActiveAdministratorIds(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: user.id })
    .from(user)
    .where(
      and(eq(user.isSystemAdmin, true), eq(user.accountStatus, 'ACTIVE'), isNull(user.deletedAt)),
    )
    .orderBy(user.id)
    .for('update');
  return rows.map((row) => row.id);
}

export async function markUserDeleted(tx: Tx, id: string, now: Date): Promise<void> {
  await tx
    .update(user)
    .set({ deletedAt: now, accountStatus: 'SUSPENDED', updatedAt: now })
    .where(and(eq(user.id, id), isNull(user.deletedAt)));
}

export async function deleteUserCredentials(tx: Tx, userId: string): Promise<void> {
  await tx.delete(account).where(eq(account.userId, userId));
}
