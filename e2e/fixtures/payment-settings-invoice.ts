import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
loadDotenv('.env.local');

async function main() {
  assertSeedAllowed();
  const [roomId, actorId, cycle, runId, kind = 'COMMON_FEE'] = process.argv.slice(2);
  if (!roomId || !actorId || !cycle || !runId) throw new Error('Missing fixture arguments.');
  if (!['COMMON_FEE', 'PROJECT_MANAGED_RENT'].includes(kind))
    throw new Error('Unsupported fixture kind.');
  const { getRoomDetail, createTenancy, createPropertyCtx } = await import(
    '../../src/modules/property-membership/application/index'
  );
  const { createBillingCtx, seedBillingRule, generateInvoicesForCycle, listInvoices } =
    await import('../../src/modules/billing-payments/application/index');
  const room = await getRoomDetail(roomId);
  if (!room.name.startsWith(`E2E-${runId}-Payments`))
    throw new Error('Fixture room is outside this test run.');
  const actor = {
    userId: actorId,
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const ctx = createBillingCtx({ requestId: randomUUID(), isSeedActor: true });
  if (kind === 'PROJECT_MANAGED_RENT') {
    await createTenancy(
      actor,
      {
        roomId,
        startsAt: new Date(`${cycle}-01T00:00:00+07:00`),
        managementMode: 'PROJECT_MANAGED',
      },
      createPropertyCtx({ requestId: randomUUID(), isSeedActor: true }),
    );
  }
  const rule = await seedBillingRule(
    actor,
    {
      kind: kind as 'COMMON_FEE' | 'PROJECT_MANAGED_RENT',
      roomId,
      configMode: 'FIXED_PROJECT',
      rate: '1000.00',
      frequency: 'MONTHLY',
      effectiveAt: new Date('2026-01-01T00:00:00Z'),
    },
    ctx,
  );
  const counts = await generateInvoicesForCycle(actor, cycle, ctx, {
    rooms: [room],
    rules: [rule],
  });
  const invoices = await listInvoices(actor, { page: 1, pageSize: 100, roomId, at: new Date() });
  const created = invoices.rows.find(
    (row) => row.periodStart === `${cycle}-01` && row.kind === kind,
  );
  if (counts.created !== 1 || !created) throw new Error('Fixture invoice was not generated.');
  console.log(JSON.stringify({ invoiceId: created.id }));
}
void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : 'Payment settings fixture failed.',
    );
    let current: unknown = error;
    for (let i = 0; i < 4 && typeof current === 'object' && current !== null; i++) {
      if ('code' in current) console.error('Code:', current.code);
      if ('constraint' in current) console.error('Constraint:', current.constraint);
      current = 'cause' in current ? current.cause : null;
    }
    process.exit(1);
  },
);
