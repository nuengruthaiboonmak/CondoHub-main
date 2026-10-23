import { runUsername } from './run-context';
import { requireScopedAdministrator } from './scoped-administrator';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../../src/shared/auth/actor';
import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
loadDotenv('.env.local');

async function main() {
  assertSeedAllowed();
  const runId = process.argv[2] ?? '';
  const { db } = await import('../../src/shared/db/client');
  const { findUserById } = await import(
    '../../src/modules/identity-access/infrastructure/userRepository'
  );
  const { createIdentityCtx, provisionSeedUser, deleteUser, setAccountStatus } = await import(
    '../../src/modules/identity-access/application/index'
  );
  const root = await requireScopedAdministrator(runId);
  const rootActor = {
    userId: root.id,
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const ctx = createIdentityCtx({ requestId: randomUUID(), isSeedActor: true });
  const results = [];
  for (const [index, kinds] of [
    ['delete', 'delete'],
    ['suspend', 'suspend'],
    ['delete', 'suspend'],
  ].entries()) {
    const actors: Actor[] = [];
    for (const side of ['a', 'b']) {
      const username = runUsername(runId, `race${index}${side}`);
      const result = await provisionSeedUser(
        rootActor,
        {
          username,
          email: `${username}@example.test`,
          name: `E2E-${runId} Lifecycle admin ${index}${side}`,
          isSystemAdmin: true,
          initialFlags: { mustChangePassword: false },
        },
        ctx,
      );
      actors.push({
        userId: result.userId,
        isSystemAdmin: true,
        accountStatus: 'ACTIVE' as const,
        mustChangePassword: false,
      });
    }
    const outcomes = await Promise.allSettled(
      actors.map((actor, side) =>
        kinds[side] === 'delete'
          ? deleteUser(actor, actors[1 - side]!.userId, ctx)
          : setAccountStatus(actor, actors[1 - side]!.userId, 'SUSPENDED', ctx),
      ),
    );
    const accounts = await Promise.all(actors.map((actor) => findUserById(db, actor.userId)));
    results.push({
      succeeded: outcomes.filter((result) => result.status === 'fulfilled').length,
      active: accounts.filter(
        (account) => account?.accountStatus === 'ACTIVE' && account.deletedAt === null,
      ).length,
    });
  }
  process.stdout.write(JSON.stringify(results));
}
void main().then(
  () => process.exit(0),
  () => {
    process.stderr.write('Could not verify the scoped lifecycle race.');
    process.exit(1);
  },
);
