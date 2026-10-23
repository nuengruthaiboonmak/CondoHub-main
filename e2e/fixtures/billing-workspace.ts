import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
loadDotenv('.env.local');

async function main() {
  assertSeedAllowed();
  const [privateRoomId, projectRoomId, adminId, runId, action] = process.argv.slice(2);
  if (!privateRoomId || !projectRoomId || !adminId || !runId)
    throw new Error('Missing fixture arguments.');
  const property = await import('../../src/modules/property-membership/application/index');
  const billing = await import('../../src/modules/billing-payments/application/index');
  const { db } = await import('../../src/shared/db/client');
  const { and, eq } = await import('drizzle-orm');
  const { jobRun } = await import('../../src/shared/db/schema/jobs');
  const key = `E2E-${runId}-BillingAudit`;
  const rooms = await Promise.all([
    property.getRoomDetail(privateRoomId),
    property.getRoomDetail(projectRoomId),
  ]);
  if (rooms.some((room) => !room.name.startsWith(key)))
    throw new Error('Fixture rooms are outside this run.');
  if (action === 'cleanup') {
    await db
      .delete(jobRun)
      .where(and(eq(jobRun.jobName, 'generate-invoices'), eq(jobRun.businessKey, key)));
    return;
  }
  const actor = {
    userId: adminId,
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const propertyCtx = property.createPropertyCtx({ requestId: randomUUID(), isSeedActor: true });
  const ctx = billing.createBillingCtx({ requestId: randomUUID(), isSeedActor: true });
  const owner = (await property.getCurrentOwners(privateRoomId))[0];
  if (!owner) throw new Error('Fixture owner is missing.');
  const reviews = [];
  for (const [index, room] of rooms.entries()) {
    const currentOwner = (await property.getCurrentOwners(room.id))[0];
    if (!currentOwner || currentOwner.userId !== owner.userId)
      throw new Error('Fixture owners differ.');
    await property.correctOwnershipInterval(
      actor,
      {
        roomId: room.id,
        ownershipId: currentOwner.ownershipId,
        startAt: new Date('2023-01-01T00:00:00Z'),
        reason: 'Prepare isolated historical billing audit.',
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
          actor,
          {
            roomId: room.id,
            startsAt: new Date(`${start}T00:00:00+07:00`),
            endsAt: new Date(`${end}T00:00:00+07:00`),
            managementMode: index === 0 ? 'PRIVATE_OWNER_MANAGED' : 'PROJECT_MANAGED',
          },
          propertyCtx,
        ),
      );
    }
    const rule = await billing.seedBillingRule(
      actor,
      {
        kind: index === 0 ? 'PRIVATE_RENT' : 'PROJECT_MANAGED_RENT',
        roomId: room.id,
        configMode: 'FIXED_PROJECT',
        rate: '1000.00',
        frequency: 'MONTHLY',
        effectiveAt: new Date('2023-01-01T00:00:00Z'),
      },
      ctx,
    );
    await billing.generateInvoicesForCycle(actor, '2025-12', ctx, { rooms: [room], rules: [rule] });
    reviews.push({ roomId: room.id, tenancies: tenancies.map((row) => row.id) });
  }
  await billing.seedPayeeInstruction(
    actor,
    {
      payeeType: 'OWNER',
      payeeId: privateRoomId,
      bankName: 'Audit bank',
      accountName: 'Audit owner',
      accountNumber: '111-000-2222',
      effectiveFrom: new Date('2023-01-01T00:00:00Z'),
    },
    ctx,
  );
  const { turnoverBillingReview, turnoverReviewResponsibleOwner } = await import(
    '../../src/modules/billing-payments/infrastructure/schema'
  );
  const base = Date.now() + 60000;
  const realReviews = await db
    .select()
    .from(turnoverBillingReview)
    .where(eq(turnoverBillingReview.calendarMonth, '2025-12-01'));
  const privateReviewId = realReviews.find((row) => row.roomId === privateRoomId)?.id;
  const projectReviewId = realReviews.find((row) => row.roomId === projectRoomId)?.id;
  if (!privateReviewId || !projectReviewId)
    throw new Error('Historical reviews were not generated.');
  const publicIds = [projectReviewId];
  const extra: Array<typeof turnoverBillingReview.$inferInsert & { id: string }> = [];
  for (let index = 0; index < 25; index++) {
    const date = new Date(Date.UTC(2040, index, 1)).toISOString().slice(0, 10);
    const isPrivate = index === 24;
    extra.push({
      id: randomUUID(),
      roomId: isPrivate ? privateRoomId : projectRoomId,
      calendarMonth: date,
      cycleStart: new Date(`${date}T00:00:00+07:00`),
      cycleTimezone: 'Asia/Bangkok',
      managementModeAtCreation: isPrivate ? 'PRIVATE_OWNER_MANAGED' : 'PROJECT_MANAGED',
      state: 'UNRESOLVED' as const,
      candidateTenancyIds: [],
      version: 1,
      createdAt: new Date(base + index),
    });
  }
  await db.transaction(async (tx) => {
    await tx.insert(turnoverBillingReview).values(extra);
    for (const [index, review] of extra.entries()) {
      if (index === 23) continue;
      await tx
        .insert(turnoverReviewResponsibleOwner)
        .values(
          [adminId, owner.userId].map((userId) => ({
            reviewId: review.id,
            userId,
            assignedAt: new Date(),
          })),
        );
    }
    await tx
      .insert(jobRun)
      .values({
        jobName: 'generate-invoices',
        businessKey: key,
        state: 'DONE',
        payload: {},
        result: { created: 0, skipped: 0, reviewRequired: 0, caughtUp: true },
        attempt: 1,
        triggerSource: 'MANUAL',
        startedAt: new Date(),
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      });
  });
  publicIds.push(...extra.map((row) => row.id));
  const job = await db.select({ id: jobRun.id }).from(jobRun).where(eq(jobRun.businessKey, key));
  console.log(
    JSON.stringify({
      publicIds,
      privateReviewId,
      projectReviewId,
      privateGrantedId: extra[24]!.id,
      blockedId: extra[23]!.id,
      privateTenancies: reviews[0]!.tenancies,
      jobId: job[0]!.id,
    }),
  );
}
void main().then(
  () => process.exit(0),
  () => {
    console.error('Billing workspace fixture failed.');
    process.exit(1);
  },
);
