import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
import { AppError } from '../../src/shared/utils/errors';
import { runUsername } from './run-context';
import { requireScopedAdministrator } from './scoped-administrator';
loadDotenv('.env.local');

async function main() {
  assertSeedAllowed();
  const runId = process.argv[2] ?? '';
  const administrator = await requireScopedAdministrator(runId);
  const root = {
    userId: administrator.id,
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const identity = await import('../../src/modules/identity-access/application/index');
  const property = await import('../../src/modules/property-membership/application/index');
  const maintenance = await import('../../src/modules/maintenance/application/index');
  const billing = await import('../../src/modules/billing-payments/application/index');
  const { db } = await import('../../src/shared/db/client');
  const { sql } = await import('drizzle-orm');
  const { insertInvoiceIdempotent, insertRentInvoiceReviewers } = await import(
    '../../src/modules/billing-payments/infrastructure/billingRepository'
  );
  const { formatProjectDate, projectDateParts } = await import('../../src/shared/utils/clock');
  const ctx = identity.createIdentityCtx({ requestId: randomUUID(), isSeedActor: true });
  const username = runUsername(runId, 'responsible');
  const account = await identity.provisionSeedUser(
    root,
    {
      username,
      email: `${username}@example.test`,
      name: `E2E-${runId}-ResponsibleOwner`,
      initialFlags: { mustChangePassword: false },
    },
    ctx,
  );
  const owner = {
    userId: account.userId,
    isSystemAdmin: false,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const propertyCtx = property.createPropertyCtx({ requestId: randomUUID() });
  const building = await property.createBuilding(
    root,
    { projectId: randomUUID(), name: `E2E-${runId}-AccountResponsibilities`, status: 'ACTIVE' },
    propertyCtx,
  );
  const floor = await property.createFloor(
    root,
    { buildingId: building.id, label: 'Account responsibilities' },
    propertyCtx,
  );
  const room = await property.createRoom(
    root,
    {
      buildingId: building.id,
      floorId: floor.id,
      name: `E2E-${runId}-AccountResponsibilities`,
      areaSqm: '30',
      status: 'ACTIVE',
    },
    propertyCtx,
  );
  await property.seedOwnership(
    root,
    { roomId: room.id, userId: owner.userId, startAt: new Date(Date.now() - 86400000) },
    property.createPropertyCtx({ requestId: randomUUID(), isSeedActor: true }),
  );
  const ticket = await maintenance.createTicket(
    owner,
    {
      roomId: room.id,
      routingKind: 'PRIVATE_OWNER',
      subject: `E2E-${runId}-AccountResponsibilities`,
      description: 'Repair the room before account deletion.',
      locationDescription: 'Bathroom',
    },
    maintenance.createMaintenanceCtx({ requestId: randomUUID() }),
  );
  const tenancy = await property.createTenancy(
    owner,
    { roomId: room.id, startsAt: new Date(), managementMode: 'PRIVATE_OWNER_MANAGED' },
    propertyCtx,
  );
  const date = formatProjectDate(projectDateParts(new Date()));
  const invoice = await db.transaction(async (tx) => {
    const inserted = await insertInvoiceIdempotent(tx, {
      roomId: room.id,
      tenancyId: tenancy.id,
      kind: 'PRIVATE_RENT',
      periodStart: `${date.slice(0, 7)}-01`,
      periodEnd: date,
      serviceStart: tenancy.startsAt,
      serviceEndExclusive: new Date(tenancy.startsAt.getTime() + 86400000),
      total: 100000n,
      dueDate: date,
      snapshotBoundaryAt: new Date(),
      snapshotTimezone: 'Asia/Bangkok',
      issuedAt: new Date(),
      paymentInstructionSnapshot: {
        bankName: 'Test bank',
        accountName: 'Scoped owner',
        accountNumber: '111-222-3333',
      },
      version: 1,
    });
    await insertRentInvoiceReviewers(tx, {
      invoiceId: inserted.id,
      reviewers: [
        {
          userId: owner.userId,
          ownershipId: (await property.getCurrentOwners(room.id))[0]!.ownershipId,
        },
      ],
      at: new Date(),
    });
    return inserted;
  });
  async function blocked() {
    try {
      await identity.deleteUser(root, owner.userId, ctx);
      return false;
    } catch (error) {
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') return true;
      throw error;
    }
  }
  const activeRentalBlocked = await blocked();
  if (!activeRentalBlocked) {
    process.stdout.write(JSON.stringify({ activeRentalBlocked }));
    return;
  }
  await property.endTenancyAt(root, { tenancyId: tenancy.id }, propertyCtx);
  const historicalWorkBlocked = await blocked();
  await maintenance.transitionTicket(
    owner,
    ticket.id,
    { status: 'COMPLETED', expectedVersion: 1 },
    maintenance.createMaintenanceCtx({ requestId: randomUUID() }),
  );
  const unpaidInvoiceBlocked = await blocked();
  await billing.editInvoiceTotal(
    owner,
    invoice.id,
    {
      total: { amount: '0.00', currency: 'THB' },
      expectedVersion: 1,
      reason: 'Waive final rent before closing the account.',
    },
    billing.createBillingCtx({ requestId: randomUUID() }),
  );
  await identity.deleteUser(root, owner.userId, ctx);
  const retained = await db.execute(
    sql`select (select count(*)::int from private_rent_invoice_reviewer where invoice_id = ${invoice.id}) as reviewers, (select count(*)::int from maintenance_recipient where request_id = ${ticket.id}) as recipients, (select count(*)::int from "user" where id = ${owner.userId} and deleted_at is not null) as deleted`,
  );
  process.stdout.write(
    JSON.stringify({
      activeRentalBlocked,
      historicalWorkBlocked,
      unpaidInvoiceBlocked,
      retained: retained.rows[0],
      roomId: room.id,
    }),
  );
}
void main().then(
  () => process.exit(0),
  () => {
    process.stderr.write('Could not verify scoped account responsibilities.');
    process.exit(1);
  },
);
