import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from './seed-common';

loadDotenv('.env.local');

async function main(): Promise<void> {
  assertSeedAllowed();
  const username = process.env.E2E_ADMIN_USERNAME ?? 'e2eadmin';
  const { createIdentityCtx, provisionSeedUser } = await import(
    '@/modules/identity-access/application/index'
  );
  const { findUserByUsername } = await import(
    '@/modules/identity-access/infrastructure/userRepository'
  );
  const { db } = await import('@/shared/db/client');
  const requestId = randomUUID();
  const ctx = createIdentityCtx({ requestId, isSeedActor: true });
  const existing = await findUserByUsername(db, username);
  if (existing !== null) {
    console.log('E2E admin already exists. Delete it or use a fresh username.');
    process.exitCode = 1;
    return;
  }
  const bootstrap = {
    userId: 'seed-bootstrap',
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const created = await provisionSeedUser(
    bootstrap,
    {
      username,
      email: `${username}@example.invalid`,
      name: 'E2E Admin',
      isSystemAdmin: true,
      initialFlags: { mustChangePassword: false, accountStatus: 'ACTIVE' },
    },
    ctx,
  );
  console.log(`E2E_ADMIN_USERNAME=${username}`);
  console.log(`E2E_ADMIN_PASSWORD=${created.tempPassword}`);
}

void main();
