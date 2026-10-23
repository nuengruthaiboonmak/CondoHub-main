import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import type { ManagementMode, RentalState } from './schema';
import { rentalPeriod } from './schema';

export interface TenancyRow {
  id: string;
  roomId: string;
  startsAt: Date;
  endsAt: Date | null;
  state: RentalState;
  managementMode: ManagementMode;
  createdBy: string | null;
}

function toTenancyRow(row: typeof rentalPeriod.$inferSelect): TenancyRow {
  return {
    id: row.id,
    roomId: row.roomId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    state: row.state,
    managementMode: row.managementMode,
    createdBy: row.createdBy,
  };
}

export async function findTenancyById(db: Db, id: string): Promise<TenancyRow | null> {
  const rows = await db.select().from(rentalPeriod).where(eq(rentalPeriod.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toTenancyRow(row);
}

export async function lockTenancyById(tx: Tx, id: string): Promise<TenancyRow | null> {
  const rows = await tx
    .select()
    .from(rentalPeriod)
    .where(eq(rentalPeriod.id, id))
    .for('update')
    .limit(1);
  return rows[0] ? toTenancyRow(rows[0]) : null;
}

export async function cancelTenancy(tx: Tx, id: string): Promise<TenancyRow | null> {
  const rows = await tx
    .update(rentalPeriod)
    .set({ state: 'CANCELLED' })
    .where(and(eq(rentalPeriod.id, id), eq(rentalPeriod.state, 'ACTIVE')))
    .returning();
  return rows[0] ? toTenancyRow(rows[0]) : null;
}

export async function listTenancyLabels(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: rentalPeriod.id,
      startsAt: rentalPeriod.startsAt,
      endsAt: rentalPeriod.endsAt,
      state: rentalPeriod.state,
    })
    .from(rentalPeriod)
    .where(inArray(rentalPeriod.id, ids));
}

export async function listTenanciesByRoom(db: Db, roomId: string): Promise<TenancyRow[]> {
  const rows = await db
    .select()
    .from(rentalPeriod)
    .where(eq(rentalPeriod.roomId, roomId))
    .orderBy(rentalPeriod.startsAt);
  return rows.map(toTenancyRow);
}

export async function listActiveTenanciesByRoom(db: Db, roomId: string): Promise<TenancyRow[]> {
  const rows = await db
    .select()
    .from(rentalPeriod)
    .where(and(eq(rentalPeriod.roomId, roomId), eq(rentalPeriod.state, 'ACTIVE')))
    .orderBy(rentalPeriod.startsAt);
  return rows.map(toTenancyRow);
}

export async function insertTenancy(
  tx: Tx,
  input: {
    roomId: string;
    startsAt: Date;
    endsAt: Date | null;
    managementMode: ManagementMode;
    createdBy: string | null;
  },
): Promise<TenancyRow> {
  const rows = await tx
    .insert(rentalPeriod)
    .values({ ...input, state: 'ACTIVE' })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Tenancy insert returned no row.');
  return toTenancyRow(row);
}

export async function endTenancy(tx: Tx, id: string, endsAt: Date): Promise<TenancyRow | null> {
  const rows = await tx
    .update(rentalPeriod)
    .set({ endsAt, state: 'ENDED' })
    .where(eq(rentalPeriod.id, id))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toTenancyRow(row);
}
