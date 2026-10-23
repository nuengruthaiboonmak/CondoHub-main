import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
import { requireScopedAdministrator } from './scoped-administrator';
loadDotenv('.env.local');

async function main() {
  assertSeedAllowed();
  const runId = process.argv[2] ?? '';
  const administrator = await requireScopedAdministrator(runId);
  const actor = {
    userId: administrator.id,
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const property = await import('../../src/modules/property-membership/application/index');
  const billing = await import('../../src/modules/billing-payments/application/index');
  const { db } = await import('../../src/shared/db/client');
  const { room, roomOwnership } = await import(
    '../../src/modules/property-membership/infrastructure/schema'
  );
  const prefix = `E2E-${runId}-EventBatch`;
  const ctx = property.createPropertyCtx({ requestId: randomUUID() });
  const building = await property.createBuilding(
    actor,
    { projectId: randomUUID(), name: prefix, status: 'ACTIVE' },
    ctx,
  );
  const floor = await property.createFloor(actor, { buildingId: building.id, label: 'Batch' }, ctx);
  const roomIds = Array.from({ length: 26 }, () => randomUUID());
  await db.transaction(async (tx) => {
    await tx
      .insert(room)
      .values(
        roomIds.map((id, index) => ({
          id,
          buildingId: building.id,
          floorId: floor.id,
          roomCode: `${prefix}-${index}`,
          name: `${prefix}-${index}`,
          areaSqm: '30',
          status: 'ACTIVE' as const,
        })),
      );
    await tx
      .insert(roomOwnership)
      .values(
        roomIds.map((roomId) => ({
          roomId,
          userId: actor.userId,
          startAt: new Date(),
          grantedBy: actor.userId,
        })),
      );
  });
  const event = await billing.createCommonFeeEvent(
    actor,
    {
      eventEffectiveDate: '2099-01-01',
      configuredAmount: { amount: '1.00', currency: 'THB' },
      chargeContext: { note: prefix },
    },
    billing.createBillingCtx({ requestId: randomUUID() }),
  );
  process.stdout.write(JSON.stringify({ eventId: event.id, roomIds }));
}
void main().then(
  () => process.exit(0),
  () => {
    process.stderr.write('Could not prepare the scoped event batch.');
    process.exit(1);
  },
);
