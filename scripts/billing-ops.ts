import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from './seed-common';

loadDotenv('.env.local');

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function issueEvent(eventId: string): Promise<void> {
  const { createBillingCtx, generateOneTimeEventInvoices } = await import(
    '@/modules/billing-payments/application/index'
  );
  const ctx = createBillingCtx({ requestId: randomUUID(), isSeedActor: true });
  const actor = {
    userId: 'seed-billing-ops',
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const counts = await generateOneTimeEventInvoices(actor, eventId, ctx);
  console.log(JSON.stringify({
    eventId,
    created: counts.created,
    skipped: counts.skipped,
    reviewRequired: counts.reviewRequired,
    cycleErrors: counts.cycleErrors.length,
  }));
}

async function holdLease(businessKey: string, holdMs: number): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { acquireJobLease, finishJobLease } = await import('@/shared/db/jobLease');
  const lease = await acquireJobLease(db, 'generate-invoices', businessKey, 'MANUAL');
  if (!lease.acquired) {
    console.log(JSON.stringify({ businessKey, held: false }));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ businessKey, held: true, attempt: lease.attempt }));
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  await finishJobLease(db, 'generate-invoices', businessKey, lease.attempt, {
    state: 'ERROR',
    error: { code: 'INTERNAL_ERROR', message: 'Lease hold released by billing ops driver.' },
  });
  console.log(JSON.stringify({ businessKey, released: true }));
}

async function probeReview(roomCode: string, calendarMonth: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { turnoverBillingReview } = await import(
    '@/modules/billing-payments/infrastructure/schema'
  );
  const { turnoverReviewResponsibleOwner } = await import(
    '@/modules/billing-payments/infrastructure/schema'
  );
  const { room } = await import('@/modules/property-membership/infrastructure/schema');
  const { eq, and } = await import('drizzle-orm');
  const rooms = await db.select().from(room).where(eq(room.roomCode, roomCode)).limit(1);
  const found = rooms[0];
  if (found === undefined) {
    console.log(JSON.stringify({ roomCode, review: null }));
    return;
  }
  const reviews = await db
    .select()
    .from(turnoverBillingReview)
    .where(
      and(
        eq(turnoverBillingReview.roomId, found.id),
        eq(turnoverBillingReview.calendarMonth, calendarMonth),
      ),
    )
    .limit(1);
  const review = reviews[0];
  if (review === undefined) {
    console.log(JSON.stringify({ roomCode, review: null }));
    return;
  }
  const owners = await db
    .select()
    .from(turnoverReviewResponsibleOwner)
    .where(eq(turnoverReviewResponsibleOwner.reviewId, review.id));
  console.log(JSON.stringify({
    roomCode,
    review: {
      id: review.id,
      state: review.state,
      candidateTenancyIds: review.candidateTenancyIds,
      snapshotOwners: owners.length,
    },
  }));
}

async function probeTurnoverResolution(reviewId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const {
    invoice,
    privateRentInvoiceReviewer,
    turnoverBillingReview,
  } = await import('@/modules/billing-payments/infrastructure/schema');
  const { eq } = await import('drizzle-orm');
  const reviews = await db
    .select()
    .from(turnoverBillingReview)
    .where(eq(turnoverBillingReview.id, reviewId))
    .limit(1);
  const review = reviews[0];
  if (review === undefined) {
    console.log(JSON.stringify({ reviewId, review: null }));
    return;
  }
  const invoices = await db
    .select()
    .from(invoice)
    .where(eq(invoice.sourceTurnoverReviewId, reviewId));
  const reviewers: Array<{ invoiceId: string; userId: string }> = [];
  for (const row of invoices) {
    const rows = await db
      .select({
        invoiceId: privateRentInvoiceReviewer.invoiceId,
        userId: privateRentInvoiceReviewer.userId,
      })
      .from(privateRentInvoiceReviewer)
      .where(eq(privateRentInvoiceReviewer.invoiceId, row.id));
    for (const entry of rows) reviewers.push(entry);
  }
  console.log(JSON.stringify({
    reviewId,
    review: {
      state: review.state,
      version: review.version,
      decisionType: review.decisionType,
      reason: review.reason,
    },
    invoices: invoices.map((row) => ({
      id: row.id,
      tenancyId: row.tenancyId,
      kind: row.kind,
      periodStart: row.periodStart,
      dueDate: row.dueDate,
      totalAmount: row.total.toString(),
      reviewerSnapshotSource: row.reviewerSnapshotSource,
      pastDueDateConfirmed: row.pastDueDateConfirmed,
      payee: row.paymentInstructionSnapshot,
    })),
    reviewers,
  }));
}

async function probeTurnoverAudit(resourceId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { auditLog } = await import('@/shared/db/schema/audit');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      afterJson: auditLog.afterJson,
    })
    .from(auditLog)
    .where(eq(auditLog.resourceId, resourceId));
  console.log(JSON.stringify({
    resourceId,
    entries: rows.map((row) => ({
      action: row.action,
      resourceType: row.resourceType,
      after: row.afterJson,
    })),
  }));
}

async function probeFeeOwners(invoiceId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { commonFeeInvoiceResponsibleOwner } = await import(
    '@/modules/billing-payments/infrastructure/schema'
  );
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({ userId: commonFeeInvoiceResponsibleOwner.userId })
    .from(commonFeeInvoiceResponsibleOwner)
    .where(eq(commonFeeInvoiceResponsibleOwner.invoiceId, invoiceId));
  console.log(JSON.stringify({ invoiceId, snapshotOwners: rows.length }));
}

async function probeRentReviewers(invoiceId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { privateRentInvoiceReviewer } = await import(
    '@/modules/billing-payments/infrastructure/schema'
  );
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({ userId: privateRentInvoiceReviewer.userId })
    .from(privateRentInvoiceReviewer)
    .where(eq(privateRentInvoiceReviewer.invoiceId, invoiceId));
  console.log(JSON.stringify({ invoiceId, snapshotReviewers: rows.map((row) => row.userId) }));
}

async function probePayments(invoiceId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const {
    listRevisionsForInvoice,
    listSubmissionsForInvoice,
  } = await import('@/modules/billing-payments/infrastructure/paymentSubmissionRepository');
  const { readInvoiceBalance } = await import(
    '@/modules/billing-payments/infrastructure/invoiceRepository'
  );
  const submissions = await listSubmissionsForInvoice(db, invoiceId);
  const revisions = await listRevisionsForInvoice(db, invoiceId);
  const balance = await db.transaction((tx) => readInvoiceBalance(tx, invoiceId));
  console.log(JSON.stringify({
    invoiceId,
    submissions: submissions.map((row) => ({
      id: row.id,
      state: row.state,
      approvedAmount: row.approvedAmount === null ? null : row.approvedAmount.toString(),
      reviewedBy: row.reviewedBy,
    })),
    revisions: revisions.map((row) => ({
      oldTotal: row.oldTotal.toString(),
      newTotal: row.newTotal.toString(),
      reason: row.reason,
      actorId: row.actorId,
    })),
    balance: {
      approvedTotal: balance.approvedTotal.toString(),
      pendingCount: balance.pendingCount,
    },
  }));
}

async function probePayee(roomCode: string, payeeType: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { room } = await import('@/modules/property-membership/infrastructure/schema');
  const { findPayeeEffectiveAt } = await import(
    '@/modules/billing-payments/infrastructure/payeeRepository'
  );
  const { eq } = await import('drizzle-orm');
  const rooms = await db.select().from(room).where(eq(room.roomCode, roomCode)).limit(1);
  const found = rooms[0];
  if (found === undefined) {
    console.log(JSON.stringify({ roomCode, payee: null }));
    return;
  }
  const payee = await findPayeeEffectiveAt(db, {
    payeeType,
    payeeId: found.id,
    at: new Date(),
  });
  console.log(JSON.stringify({
    roomCode,
    payee:
      payee === null
        ? null
        : {
            bankName: payee.bankName,
            accountName: payee.accountName,
            accountNumber: payee.accountNumber,
            qrImageId: payee.qrImageId,
          },
  }));
}

async function addMember(input: {
  roomCode: string;
  username: string;
  tenancyId: string;
  role: string;
  at: string;
  end?: string | undefined;
}): Promise<void> {
  const { randomUUID: uuid } = await import('node:crypto');
  const { db } = await import('@/shared/db/client');
  const { room } = await import('@/modules/property-membership/infrastructure/schema');
  const { eq } = await import('drizzle-orm');
  const { findUserByUsername } = await import(
    '@/modules/identity-access/infrastructure/userRepository'
  );
  const {
    addMembership,
    createPropertyCtx,
    endMembershipAt,
  } = await import('@/modules/property-membership/application/index');
  const rooms = await db.select().from(room).where(eq(room.roomCode, input.roomCode)).limit(1);
  const found = rooms[0];
  if (found === undefined) throw new Error(`Room ${input.roomCode} was not found.`);
  const target = await findUserByUsername(db, input.username.trim().toLowerCase());
  if (target === null) throw new Error(`User ${input.username} was not found.`);
  const actor = {
    userId: 'seed-billing-ops',
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const ctx = createPropertyCtx({ requestId: uuid(), isSeedActor: true });
  const created = await addMembership(
    actor,
    {
      roomId: found.id,
      userId: target.id,
      memberRole: input.role as 'MAIN' | 'SUB',
      tenancyId: input.tenancyId,
      effectiveAt: new Date(input.at),
    },
    ctx,
  );
  let endAt: string | null = null;
  if (input.end !== undefined) {
    const ended = await endMembershipAt(
      actor,
      { roomId: found.id, membershipId: created.id, endsAt: new Date(input.end) },
      ctx,
    );
    endAt = ended.endAt === null ? null : ended.endAt.toISOString();
  }
  console.log(JSON.stringify({
    membershipId: created.id,
    roomId: found.id,
    userId: target.id,
    startAt: created.startAt.toISOString(),
    endAt,
  }));
}

async function main(): Promise<void> {
  assertSeedAllowed();
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === 'issue-event') {
    const eventId = flagValue(argv, '--event');
    if (eventId === undefined || eventId === '') throw new Error('Missing required --event <id>.');
    await issueEvent(eventId);
    return;
  }
  if (command === 'hold-lease') {
    const key = flagValue(argv, '--key');
    const ms = Number(flagValue(argv, '--ms') ?? '15000');
    if (key === undefined || key === '') throw new Error('Missing required --key <business-key>.');
    if (!Number.isInteger(ms) || ms < 1000 || ms > 120000) throw new Error('The --ms hold must be 1000..120000.');
    await holdLease(key, ms);
    return;
  }
  if (command === 'probe-review') {
    const code = flagValue(argv, '--room');
    const month = flagValue(argv, '--month');
    if (code === undefined || code === '') throw new Error('Missing required --room <room-code>.');
    if (month === undefined || month === '') throw new Error('Missing required --month <YYYY-MM-01>.');
    await probeReview(code, month);
    return;
  }
  if (command === 'probe-fee-owners') {
    const invoiceId = flagValue(argv, '--invoice');
    if (invoiceId === undefined || invoiceId === '') throw new Error('Missing required --invoice <id>.');
    await probeFeeOwners(invoiceId);
    return;
  }
  if (command === 'probe-turnover') {
    const reviewId = flagValue(argv, '--review');
    if (reviewId === undefined || reviewId === '') throw new Error('Missing required --review <id>.');
    await probeTurnoverResolution(reviewId);
    return;
  }
  if (command === 'probe-audit') {
    const resourceId = flagValue(argv, '--resource');
    if (resourceId === undefined || resourceId === '') throw new Error('Missing required --resource <id>.');
    await probeTurnoverAudit(resourceId);
    return;
  }
  if (command === 'probe-rent-reviewers') {
    const invoiceId = flagValue(argv, '--invoice');
    if (invoiceId === undefined || invoiceId === '') throw new Error('Missing required --invoice <id>.');
    await probeRentReviewers(invoiceId);
    return;
  }
  if (command === 'probe-payments') {
    const invoiceId = flagValue(argv, '--invoice');
    if (invoiceId === undefined || invoiceId === '') throw new Error('Missing required --invoice <id>.');
    await probePayments(invoiceId);
    return;
  }
  if (command === 'probe-payee') {
    const roomCode = flagValue(argv, '--room');
    const payeeType = flagValue(argv, '--type');
    if (roomCode === undefined || roomCode === '') throw new Error('Missing required --room <room-code>.');
    if (payeeType === undefined || payeeType === '') throw new Error('Missing required --type <payee-type>.');
    await probePayee(roomCode, payeeType);
    return;
  }
  if (command === 'add-member') {
    const roomCode = flagValue(argv, '--room');
    const username = flagValue(argv, '--user');
    const tenancyId = flagValue(argv, '--tenancy');
    const role = flagValue(argv, '--role') ?? 'SUB';
    const at = flagValue(argv, '--at');
    const end = flagValue(argv, '--end');
    if (roomCode === undefined || roomCode === '') throw new Error('Missing required --room <room-code>.');
    if (username === undefined || username === '') throw new Error('Missing required --user <username>.');
    if (tenancyId === undefined || tenancyId === '') throw new Error('Missing required --tenancy <id>.');
    if (at === undefined || at === '') throw new Error('Missing required --at <iso-date>.');
    await addMember({
      roomCode,
      username,
      tenancyId,
      role,
      at,
      ...(end !== undefined ? { end } : {}),
    });
    return;
  }
  throw new Error(`Unknown billing-ops command: ${command ?? '(none)'}.`);
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
