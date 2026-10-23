import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import { idempotencyKey, type IdempotencyScope } from '@/shared/db/schema/idempotency';

export interface TurnoverIdempotencyRecord {
  scope: IdempotencyScope;
  key: string;
  actorId: string | null;
  requestHash: string;
  resultRefType: string | null;
  resultRefId: string | null;
}

function toRecord(row: typeof idempotencyKey.$inferSelect): TurnoverIdempotencyRecord {
  return {
    scope: row.scope,
    key: row.key,
    actorId: row.actorId,
    requestHash: row.requestHash,
    resultRefType: row.resultRefType,
    resultRefId: row.resultRefId,
  };
}

export async function getTurnoverIdempotencyRecord(
  conn: Db,
  input: { scope: IdempotencyScope; key: string },
): Promise<TurnoverIdempotencyRecord | null> {
  const rows = await conn
    .select()
    .from(idempotencyKey)
    .where(and(eq(idempotencyKey.scope, input.scope), eq(idempotencyKey.key, input.key)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function upsertTurnoverIdempotencyRecord(
  tx: Tx,
  input: {
    scope: IdempotencyScope;
    key: string;
    actorId: string | null;
    requestHash: string;
    resultRefType: string | null;
    resultRefId: string | null;
    expiresAt: Date;
  },
): Promise<void> {
  await tx
    .insert(idempotencyKey)
    .values({
      scope: input.scope,
      key: input.key,
      actorId: input.actorId,
      requestHash: input.requestHash,
      resultRefType: input.resultRefType,
      resultRefId: input.resultRefId,
      expiresAt: input.expiresAt,
    })
    .onConflictDoUpdate({
      target: [idempotencyKey.scope, idempotencyKey.key],
      set: {
        requestHash: input.requestHash,
        resultRefType: input.resultRefType,
        resultRefId: input.resultRefId,
        expiresAt: input.expiresAt,
      },
    });
}
