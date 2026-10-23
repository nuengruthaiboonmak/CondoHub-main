import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createInternalAdapter } from 'better-auth/db';
import { createUsernamePlugin } from '@/modules/identity-access/infrastructure/usernamePlugin';
import { user } from '@/modules/identity-access/infrastructure/betterAuthSchema';
import * as betterAuthSchema from '@/modules/identity-access/infrastructure/betterAuthSchema';

function loadDotenv(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotenv('.env.local');

const ALPHANUMERIC = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generateTempPassword(length = 20): string {
  const bytes = randomBytes(length);
  let password = '';
  for (const byte of bytes) password += ALPHANUMERIC[byte % ALPHANUMERIC.length];
  return password;
}

async function main(): Promise<void> {
  if (process.env.SEED_ENABLED !== 'true') throw new Error('Refusing to seed: SEED_ENABLED is not true.');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production.');
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === '') throw new Error('Missing DATABASE_URL.');
  const pool = new Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: false } });
  try {
    const db = drizzle(pool);
    const existing = await db
      .select({ id: user.id, isSystemAdmin: user.isSystemAdmin })
      .from(user)
      .where(eq(user.username, 'admin'))
      .limit(1);
    const found = existing[0];
    if (found !== undefined) {
      if (!found.isSystemAdmin) {
        await db.update(user).set({ isSystemAdmin: true }).where(eq(user.id, found.id));
      }
      console.log(`Bootstrap admin already exists. username=admin id=${found.id} isSystemAdmin ensured.`);
      return;
    }
    const tempPassword = generateTempPassword();
    const auth = betterAuth({
      database: drizzleAdapter(db, { provider: 'pg', schema: betterAuthSchema }),
      emailAndPassword: { enabled: true, disableSignUp: true },
      plugins: [createUsernamePlugin()],
      user: {
        additionalFields: {
          phone: { type: 'string', required: false },
          accountStatus: { type: 'string', required: true, defaultValue: 'ACTIVE', input: false },
          mustChangePassword: { type: 'boolean', required: true, defaultValue: true, input: false },
          isSystemAdmin: { type: 'boolean', required: true, defaultValue: false, input: false },
        },
      },
    });
    const ctx = await auth.$context;
    const created = await db.transaction(async (tx) => {
      const txAdapter = drizzleAdapter(tx, { provider: 'pg', schema: betterAuthSchema })(ctx.options);
      const ia = createInternalAdapter(txAdapter, {
        options: ctx.options,
        logger: ctx.logger,
        hooks: [],
        generateId: ctx.generateId,
      });
      const createdUser = await ia.createUser({
        name: 'Bootstrap Admin',
        email: 'admin@condohub.invalid',
        username: 'admin',
        accountStatus: 'ACTIVE',
        mustChangePassword: true,
        isSystemAdmin: true,
      }, { method: 'admin' });
      if (createdUser === null) throw new Error('Bootstrap admin creation failed.');
      const hash = await ctx.password.hash(tempPassword);
      await ia.linkAccount({
        providerId: 'credential',
        accountId: createdUser.id,
        userId: createdUser.id,
        password: hash,
      });
      return createdUser;
    });
    console.log(`Bootstrap admin created. username=admin id=${created.id} tempPassword=${tempPassword}`);
    console.log('This password is shown once. Change it at first login.');
  } finally {
    await pool.end();
  }
}

void main();
