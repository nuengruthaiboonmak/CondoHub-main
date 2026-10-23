import { requireScopedAdministrator } from './scoped-administrator';
import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
loadDotenv('.env.local');

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
  const billing = await import('../../src/modules/billing-payments/application/index');
  const { formatProjectDate, projectDateParts } = await import('../../src/shared/utils/clock');
  const propertyCtx = property.createPropertyCtx({ requestId: randomUUID() });
  const billingCtx = billing.createBillingCtx({ requestId: randomUUID() });
  const building = await property.createBuilding(
    actor,
    { projectId: randomUUID(), name: `E2E-${runId}-EventRetry`, status: 'ACTIVE' },
    propertyCtx,
  );
  const floor = await property.createFloor(
    actor,
    { buildingId: building.id, label: 'Event retry' },
    propertyCtx,
  );
  const rooms = [];
  for (const index of [1, 2])
    rooms.push(
      await property.createRoom(
        actor,
        {
          buildingId: building.id,
          floorId: floor.id,
          name: `E2E-${runId}-EventRetry-${index}`,
          areaSqm: '30',
          status: 'ACTIVE',
        },
        propertyCtx,
      ),
    );
  const previousDay = new Date(Date.now() - 86400000);
  await property.createTenancy(
    actor,
    { roomId: rooms[0]!.id, startsAt: previousDay, managementMode: 'PROJECT_MANAGED' },
    propertyCtx,
  );
  const event = await billing.createCommonFeeEvent(
    actor,
    {
      eventEffectiveDate: formatProjectDate(projectDateParts(new Date())),
      configuredAmount: { amount: '500.00', currency: 'THB' },
      chargeContext: { note: `E2E-${runId}-EventRetry` },
    },
    billingCtx,
  );
  const first = await billing.generateOneTimeEventInvoices(actor, event.id, billingCtx, { rooms });
  const afterFirst = await billing.getCommonFeeEvent(actor, event.id);
  await property.seedOwnership(
    actor,
    { roomId: rooms[1]!.id, userId: actor.userId, startAt: previousDay },
    property.createPropertyCtx({ requestId: randomUUID(), isSeedActor: true }),
  );
  const retry = await billing.generateOneTimeEventInvoices(actor, event.id, billingCtx, { rooms });
  const afterRetry = await billing.getCommonFeeEvent(actor, event.id);
  const repeated = await billing.generateOneTimeEventInvoices(actor, event.id, billingCtx, {
    rooms,
  });
  const invoices = await db.execute(
    sql`select count(*)::int as count from invoice where one_time_charge_event_id = ${event.id}`,
  );
  process.stdout.write(
    JSON.stringify({
      first: {
        created: first.created,
        errors: first.cycleErrors.length,
        status: afterFirst?.status,
      },
      retry: {
        created: retry.created,
        skipped: retry.skipped,
        errors: retry.cycleErrors.length,
        status: afterRetry?.status,
      },
      repeated: { created: repeated.created },
      invoices: invoices.rows[0]?.count,
    }),
  );
}
void main().then(
  () => process.exit(0),
  () => {
    process.stderr.write('Could not verify the scoped one-time event retry.');
    process.exit(1);
  },
);
