import { requireScopedAdministrator } from './scoped-administrator';
import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
import { AppError } from '../../src/shared/utils/errors';
loadDotenv('.env.local');
let stage = 'setup';

async function main() {
  assertSeedAllowed();
  const runId = process.argv[2] ?? '';
  const { db } = await import('../../src/shared/db/client');
  const { sql } = await import('drizzle-orm');
  const root = await requireScopedAdministrator(runId);
  const actor = {
    userId: root.id,
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const property = await import('../../src/modules/property-membership/application/index');
  const { lockPropertyScope } = await import(
    '../../src/modules/property-membership/infrastructure/structureRepository'
  );
  const { listMembershipsByRoom } = await import(
    '../../src/modules/property-membership/infrastructure/membershipRepository'
  );
  const ctx = property.createPropertyCtx({ requestId: randomUUID() });
  const results = [];
  for (const action of ['CANCEL', 'END'] as const) {
    stage = `${action}:create-property`;
    const building = await property.createBuilding(
      actor,
      { projectId: randomUUID(), name: `E2E-${runId}-MembershipRace-${action}`, status: 'ACTIVE' },
      ctx,
    );
    const floor = await property.createFloor(
      actor,
      { buildingId: building.id, label: 'Race floor' },
      ctx,
    );
    const room = await property.createRoom(
      actor,
      {
        buildingId: building.id,
        floorId: floor.id,
        name: `E2E-${runId}-MembershipRace-${action}`,
        areaSqm: '30',
        status: 'ACTIVE',
      },
      ctx,
    );
    const tenancy = await property.createTenancy(
      actor,
      {
        roomId: room.id,
        startsAt: new Date(Date.now() + (action === 'CANCEL' ? 1 : -1) * 86400000),
        managementMode: 'PROJECT_MANAGED',
      },
      ctx,
    );
    let release!: () => void;
    let acquired!: (pid: number) => void;
    const ready = new Promise<number>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await lockPropertyScope(tx, 'room', room.id);
      const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
      acquired(Number(pid.rows[0]?.pid));
      await gate;
    });
    const blockerPid = await ready;
    stage = `${action}:wait-for-membership-lock`;
    let addingState = 'PENDING';
    const adding = property
      .addMembership(
        actor,
        { roomId: room.id, userId: actor.userId, tenancyId: tenancy.id, memberRole: 'SUB' },
        ctx,
      )
      .then(
        () => (addingState = 'CREATED'),
        (error: unknown) =>
          (addingState = error instanceof AppError ? error.code : 'UNEXPECTED_ERROR'),
      );
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiters = await db.execute(
          sql`select distinct pid from pg_locks where not granted and ${blockerPid} = any(pg_blocking_pids(pid))`,
        );
        if (waiters.rows.length > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!blocked) {
        stage = `${action}:wait-for-membership-lock:${addingState}`;
        throw new Error('The membership request did not reach its write lock.');
      }
      stage = `${action}:close-rental`;
      if (action === 'CANCEL') await property.cancelScheduledTenancy(actor, tenancy.id, ctx);
      else await property.endTenancyAt(actor, { tenancyId: tenancy.id }, ctx);
    } finally {
      release();
      await blocker;
    }
    stage = `${action}:verify-membership`;
    const outcome = await adding;
    const memberships = await listMembershipsByRoom(db, room.id);
    results.push({ action, outcome, memberships: memberships.length });
  }
  process.stdout.write(JSON.stringify(results));
}
void main().then(
  () => process.exit(0),
  (error: unknown) => {
    const code =
      error instanceof AppError ? error.code : error instanceof Error ? error.name : 'UNKNOWN';
    process.stderr.write(`Could not verify the scoped membership race at ${stage} (${code}).`);
    process.exit(1);
  },
);
