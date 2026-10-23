import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';

export type SharedSchema = Record<string, never>;

export type Database = NodePgDatabase<SharedSchema>;

export type Tx = PgTransaction<
  NodePgQueryResultHKT,
  SharedSchema,
  ExtractTablesWithRelations<SharedSchema>
>;

export type Db = Database | Tx;

export async function withTransaction<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
