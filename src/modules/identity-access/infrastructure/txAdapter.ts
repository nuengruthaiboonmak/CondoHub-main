import 'server-only';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createInternalAdapter } from 'better-auth/db';
import type { Tx } from '@/shared/db/transaction';
import { auth } from './betterAuth';
import * as schema from './betterAuthSchema';

export type TxInternalAdapter = Awaited<ReturnType<typeof createTxInternalAdapter>>['adapter'];

export interface TxAuthContext {
  adapter: ReturnType<typeof createInternalAdapter>;
  hashPassword(password: string): Promise<string>;
  verifyPassword(hash: string, password: string): Promise<boolean>;
}

export async function createTxInternalAdapter(tx: Tx): Promise<TxAuthContext> {
  const ctx = await auth.$context;
  const txAdapter = drizzleAdapter(tx, { provider: 'pg', schema })(ctx.options);
  const adapter = createInternalAdapter(txAdapter, {
    options: ctx.options,
    logger: ctx.logger,
    hooks: [],
    generateId: ctx.generateId,
  });
  return {
    adapter,
    hashPassword: (password: string) => ctx.password.hash(password),
    verifyPassword: (hash: string, password: string) => ctx.password.verify({ hash, password }),
  };
}
