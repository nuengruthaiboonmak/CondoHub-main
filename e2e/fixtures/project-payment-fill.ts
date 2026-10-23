import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
loadDotenv('.env.local');
async function main() {
  assertSeedAllowed();
  const [missingId, configuredId, actorId, runId] = process.argv.slice(2);
  if (!missingId || !configuredId || !actorId || !runId)
    throw new Error('Missing fixture arguments.');
  const { db } = await import('../../src/shared/db/client');
  const { invoice } = await import('../../src/modules/billing-payments/infrastructure/schema');
  const { fillMissingInvoiceInstructions } = await import(
    '../../src/modules/billing-payments/infrastructure/invoiceRepository'
  );
  const { getRoomDetail } = await import('../../src/modules/property-membership/application/index');
  const { eq } = await import('drizzle-orm');
  const [before] = await db.select().from(invoice).where(eq(invoice.id, missingId));
  if (!before || !(await getRoomDetail(before.roomId)).name.startsWith(`E2E-${runId}-Payments`))
    throw new Error('Fixture is outside this run.');
  const rollback = new Error('rollback verified project account fill');
  let verified = false;
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(invoice)
        .set({
          paymentInstructionSnapshot: {
            bankName: 'System',
            accountName: 'System',
            accountNumber: 'SYSTEM-AUTO',
            qrImageId: null,
          },
        })
        .where(eq(invoice.id, missingId));
      const ids = await fillMissingInvoiceInstructions(tx, {
        payeeType: 'PROJECT',
        actorId,
        snapshot: {
          bankName: 'Rollback check',
          accountName: 'Rollback check',
          accountNumber: 'ROLLBACK-ONLY',
          qrImageId: null,
        },
        at: new Date(),
      });
      if (!ids.includes(missingId) || ids.includes(configuredId))
        throw new Error('Project account fill matched the wrong invoices.');
      const [updated] = await tx.select().from(invoice).where(eq(invoice.id, missingId));
      if (
        (updated?.paymentInstructionSnapshot as Record<string, unknown> | null)?.accountNumber !==
        'ROLLBACK-ONLY'
      )
        throw new Error('Missing account was not filled.');
      verified = true;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const [after] = await db.select().from(invoice).where(eq(invoice.id, missingId));
  if (
    !verified ||
    JSON.stringify(after?.paymentInstructionSnapshot) !==
      JSON.stringify(before.paymentInstructionSnapshot)
  )
    throw new Error('Rollback did not preserve the original invoice.');
  console.log('Project account fill verified without retaining changes.');
}
void main().then(
  () => process.exit(0),
  () => {
    console.error('Project account fill verification failed.');
    process.exit(1);
  },
);
