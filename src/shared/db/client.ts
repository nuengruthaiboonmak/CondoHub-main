import 'server-only';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '@/config/env';
import type { Database } from './transaction';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 10_000,
});

pool.on('error', () => {
  process.exitCode = 1;
});

export const db: Database = drizzle(pool);

export async function closeDb(): Promise<void> {
  await pool.end();
}
