import { assertSeedAllowed } from '../../scripts/seed-common';
import { poolAdminFor, readRunContext } from './run-context';

export async function requireScopedAdministrator(runId: string | undefined) {
  assertSeedAllowed();
  const context = await readRunContext();
  if (
    !runId ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(runId) ||
    context.runId !== runId ||
    !context.admins?.length
  )
    throw new Error('An active isolated test run is required.');
  const username = poolAdminFor(context, 'workspace').username;
  if (!username.startsWith(`e2e${runId.replace(/[^a-z0-9]/gi, '').toLowerCase()}`))
    throw new Error('The administrator is outside this test run.');
  const { db } = await import('../../src/shared/db/client');
  const { findUserByUsername } = await import(
    '../../src/modules/identity-access/infrastructure/userRepository'
  );
  const account = await findUserByUsername(db, username);
  if (
    !account ||
    !account.isSystemAdmin ||
    account.accountStatus !== 'ACTIVE' ||
    account.deletedAt !== null
  )
    throw new Error('The scoped administrator is unavailable.');
  return account;
}
