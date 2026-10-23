import 'server-only';
import { asc, eq } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import { maintenanceStatusHistory } from './schema';

export interface TicketHistoryRecord {
  id: string;
  requestId: string;
  fromState: string;
  toState: string;
  actorId: string | null;
  reason: string | null;
  changedAt: Date;
}

function toRecord(row: typeof maintenanceStatusHistory.$inferSelect): TicketHistoryRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    fromState: row.fromState,
    toState: row.toState,
    actorId: row.actorId,
    reason: row.reason,
    changedAt: row.changedAt,
  };
}

export async function insertStatusHistory(
  tx: Tx,
  input: {
    requestId: string;
    fromState: string;
    toState: string;
    actorId: string | null;
    reason: string | null;
    changedAt: Date;
  },
): Promise<void> {
  await tx.insert(maintenanceStatusHistory).values({
    requestId: input.requestId,
    fromState: input.fromState,
    toState: input.toState,
    actorId: input.actorId,
    reason: input.reason,
    changedAt: input.changedAt,
  });
}

export async function listStatusHistory(
  conn: Db,
  requestId: string,
): Promise<TicketHistoryRecord[]> {
  const rows = await conn
    .select()
    .from(maintenanceStatusHistory)
    .where(eq(maintenanceStatusHistory.requestId, requestId))
    .orderBy(asc(maintenanceStatusHistory.changedAt), asc(maintenanceStatusHistory.id));
  return rows.map(toRecord);
}
