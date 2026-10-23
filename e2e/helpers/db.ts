import { Pool } from 'pg';

export const E2E_DB_SETUP_ONLY =
  'SETUP-ONLY: global setup/teardown and run-scoped cleanup. Specs MUST NOT use this for behavior assertions — assert via UI + API.' as const;

export interface DbSetupClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  close(): Promise<void>;
}

function setupConnectionString(): string {
  const value = process.env.DATABASE_URL;
  if (value === undefined || value === '') {
    throw new Error('E2E setup needs the DATABASE_URL env var.');
  }
  return value;
}

export async function setupOnlyDb(): Promise<DbSetupClient> {
  const pool = new Pool({
    connectionString: setupConnectionString(),
    max: 5,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 10_000,
  });
  pool.on('error', () => {
    process.exitCode = 1;
  });
  await pool.query('SELECT 1');
  return {
    query: async (text: string, params?: unknown[]) => {
      const result = await pool.query(text, params as unknown[] | undefined);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    close: async () => {
      await pool.end();
    },
  };
}

export async function countRowsLike(
  client: DbSetupClient,
  table: string,
  column: string,
  runId: string,
): Promise<number> {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} LIKE '%' || $1 || '%'`,
    [runId],
  );
  return (result.rows[0]?.count as number | undefined) ?? 0;
}
