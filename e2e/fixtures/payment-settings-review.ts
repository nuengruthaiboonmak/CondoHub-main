import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
loadDotenv('.env.local');

async function main() {
  assertSeedAllowed();
  const [roomId, adminId, runId] = process.argv.slice(2);
  if (!roomId || !adminId || !runId) throw new Error('Missing fixture arguments.');
  const property = await import('../../src/modules/property-membership/application/index');
  const billing = await import('../../src/modules/billing-payments/application/index');
  const room = await property.getRoomDetail(roomId);
  if (!room.name.startsWith(`E2E-${runId}-Payments`))
    throw new Error('Fixture room is outside this run.');
  const admin = {
    userId: adminId,
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const [owner] = await property.getCurrentOwners(roomId);
  if (!owner) throw new Error('Fixture owner is missing.');
  const propertyCtx = property.createPropertyCtx({ requestId: randomUUID(), isSeedActor: true });
  await property.correctOwnershipInterval(
    admin,
    {
      roomId,
      ownershipId: owner.ownershipId,
      startAt: new Date('2023-01-01T00:00:00Z'),
      reason: 'Verify historical invoice account configuration.',
    },
    propertyCtx,
  );
  const tenancies = [];
  for (const [start, end] of [
    ['2025-12-01', '2025-12-15'],
    ['2025-12-15', '2026-01-01'],
  ]) {
    tenancies.push(
      await property.createTenancy(
        admin,
        {
          roomId,
          startsAt: new Date(`${start}T00:00:00+07:00`),
          endsAt: new Date(`${end}T00:00:00+07:00`),
          managementMode: 'PRIVATE_OWNER_MANAGED',
        },
        propertyCtx,
      ),
    );
  }
  const ctx = billing.createBillingCtx({ requestId: randomUUID(), isSeedActor: true });
  const rule = await billing.seedBillingRule(
    admin,
    {
      kind: 'PRIVATE_RENT',
      roomId,
      configMode: 'FIXED_PROJECT',
      rate: '1000.00',
      frequency: 'MONTHLY',
      effectiveAt: new Date('2023-01-01T00:00:00Z'),
    },
    ctx,
  );
  const counts = await billing.generateInvoicesForCycle(admin, '2025-12', ctx, {
    rooms: [room],
    rules: [rule],
  });
  if (counts.privateReviews !== 1) throw new Error('Historical turnover review was not generated.');
  const actor = { ...admin, userId: owner.userId, isSystemAdmin: false };
  const reviews = await billing.listTurnoverReviews(actor, { page: 1, pageSize: 100 });
  const review = reviews.rows.find((row) => row.roomId === roomId);
  if (!review) throw new Error('Historical review is not visible to its owner.');
  const result = await billing.resolveTurnoverReview(
    actor,
    review.id,
    {
      decision: 'ISSUE_INVOICES',
      selectedTenancyIds: tenancies.map((row) => row.id),
      perInvoice: tenancies.map((row) => ({ tenancyId: row.id, dueDate: '2099-01-01' })),
      expectedVersion: review.version,
    },
    ctx,
  );
  if (result.invoices.length !== 2)
    throw new Error('Historical review did not issue both invoices.');
  for (const row of result.invoices) {
    const instruction = await billing.getPaymentInstruction(actor, row.id, new Date());
    if (instruction?.accountNumber !== '111-222-3333')
      throw new Error('The configured account did not reach the historical invoice.');
  }
  const { db } = await import('../../src/shared/db/client');
  const { invoice } = await import('../../src/modules/billing-payments/infrastructure/schema');
  const { fillMissingInvoiceInstructions, readPayeeSnapshot } = await import(
    '../../src/modules/billing-payments/infrastructure/invoiceRepository'
  );
  const { systemAutoPayee, payeeSnapshotToRecord } = await import(
    '../../src/modules/billing-payments/domain/payeePolicy'
  );
  const { eq } = await import('drizzle-orm');
  const rollback = new Error('rollback fixture verification');
  const invoiceId = result.invoices[0]?.id;
  if (!invoiceId) throw new Error('Historical invoice is missing.');
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(invoice)
        .set({ paymentInstructionSnapshot: payeeSnapshotToRecord(systemAutoPayee()) })
        .where(eq(invoice.id, invoiceId));
      const snapshot = {
        bankName: 'Verified Bank',
        accountName: 'Verified owner',
        accountNumber: 'Verified',
        qrImageId: null,
      };
      const denied = await fillMissingInvoiceInstructions(tx, {
        roomId,
        payeeType: 'OWNER',
        actorId: adminId,
        snapshot,
        at: new Date(),
      });
      if (denied.length !== 0)
        throw new Error('A non-reviewer changed private invoice payment details.');
      const unchanged = (await readPayeeSnapshot(tx, invoiceId)) as { accountNumber?: string };
      if (unchanged.accountNumber !== 'SYSTEM-AUTO')
        throw new Error('A private invoice was changed without its reviewer.');
      const updated = await fillMissingInvoiceInstructions(tx, {
        roomId,
        payeeType: 'OWNER',
        actorId: owner.userId,
        snapshot,
        at: new Date(),
      });
      if (updated.length !== 1 || updated[0] !== invoiceId)
        throw new Error('The responsible owner could not fill the missing account.');
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log('Historical invoice payment settings and reviewer scope verified.');
}
void main().then(
  () => process.exit(0),
  () => {
    console.error('Historical invoice payment settings verification failed.');
    process.exit(1);
  },
);
