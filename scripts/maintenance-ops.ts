import { assertSeedAllowed, loadDotenv } from './seed-common';

loadDotenv('.env.local');

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function probeTicket(ticketId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const {
    maintenanceComment,
    maintenanceRecipient,
    maintenanceRequest,
    maintenanceStatusHistory,
  } = await import('@/modules/maintenance/infrastructure/schema');
  const { eq, asc } = await import('drizzle-orm');
  const rows = await db
    .select()
    .from(maintenanceRequest)
    .where(eq(maintenanceRequest.id, ticketId))
    .limit(1);
  const ticket = rows[0];
  if (ticket === undefined) {
    console.log(JSON.stringify({ ticketId, ticket: null }));
    return;
  }
  const [recipients, comments, history] = await Promise.all([
    db
      .select({
        userId: maintenanceRecipient.recipientUserId,
        ownershipIntervalRef: maintenanceRecipient.ownershipIntervalRef,
      })
      .from(maintenanceRecipient)
      .where(eq(maintenanceRecipient.requestId, ticketId)),
    db
      .select({ id: maintenanceComment.id, authorId: maintenanceComment.authorId })
      .from(maintenanceComment)
      .where(eq(maintenanceComment.requestId, ticketId))
      .orderBy(asc(maintenanceComment.createdAt), asc(maintenanceComment.id)),
    db
      .select({
        fromState: maintenanceStatusHistory.fromState,
        toState: maintenanceStatusHistory.toState,
        actorId: maintenanceStatusHistory.actorId,
      })
      .from(maintenanceStatusHistory)
      .where(eq(maintenanceStatusHistory.requestId, ticketId))
      .orderBy(asc(maintenanceStatusHistory.changedAt)),
  ]);
  console.log(JSON.stringify({
    ticketId,
    ticket: {
      routingKind: ticket.routingKind,
      roomId: ticket.roomId,
      status: ticket.status,
      version: ticket.version,
      reporterId: ticket.reporterId,
    },
    recipients,
    comments,
    history,
  }));
}

async function probeRecipients(ticketId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { maintenanceRecipient } = await import('@/modules/maintenance/infrastructure/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({
      userId: maintenanceRecipient.recipientUserId,
      ownershipIntervalRef: maintenanceRecipient.ownershipIntervalRef,
    })
    .from(maintenanceRecipient)
    .where(eq(maintenanceRecipient.requestId, ticketId));
  console.log(JSON.stringify({ ticketId, recipients: rows }));
}

async function probeHistory(ticketId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { maintenanceStatusHistory } = await import('@/modules/maintenance/infrastructure/schema');
  const { eq, asc } = await import('drizzle-orm');
  const rows = await db
    .select({
      fromState: maintenanceStatusHistory.fromState,
      toState: maintenanceStatusHistory.toState,
      actorId: maintenanceStatusHistory.actorId,
      reason: maintenanceStatusHistory.reason,
    })
    .from(maintenanceStatusHistory)
    .where(eq(maintenanceStatusHistory.requestId, ticketId))
    .orderBy(asc(maintenanceStatusHistory.changedAt));
  console.log(JSON.stringify({ ticketId, history: rows }));
}

async function probeTicketCount(roomCode: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { maintenanceRequest } = await import('@/modules/maintenance/infrastructure/schema');
  const { room } = await import('@/modules/property-membership/infrastructure/schema');
  const { eq } = await import('drizzle-orm');
  const rooms = await db.select().from(room).where(eq(room.roomCode, roomCode)).limit(1);
  const found = rooms[0];
  if (found === undefined) {
    console.log(JSON.stringify({ roomCode, count: 0 }));
    return;
  }
  const rows = await db
    .select({ id: maintenanceRequest.id })
    .from(maintenanceRequest)
    .where(eq(maintenanceRequest.roomId, found.id));
  console.log(JSON.stringify({ roomCode, count: rows.length }));
}

async function main(): Promise<void> {
  assertSeedAllowed();
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === 'probe-ticket') {
    const ticketId = flagValue(argv, '--ticket');
    if (ticketId === undefined || ticketId === '') throw new Error('Missing required --ticket <id>.');
    await probeTicket(ticketId);
    return;
  }
  if (command === 'probe-recipients') {
    const ticketId = flagValue(argv, '--ticket');
    if (ticketId === undefined || ticketId === '') throw new Error('Missing required --ticket <id>.');
    await probeRecipients(ticketId);
    return;
  }
  if (command === 'probe-history') {
    const ticketId = flagValue(argv, '--ticket');
    if (ticketId === undefined || ticketId === '') throw new Error('Missing required --ticket <id>.');
    await probeHistory(ticketId);
    return;
  }
  if (command === 'probe-ticket-count') {
    const roomCode = flagValue(argv, '--room');
    if (roomCode === undefined || roomCode === '') throw new Error('Missing required --room <room-code>.');
    await probeTicketCount(roomCode);
    return;
  }
  throw new Error(`Unknown maintenance-ops command: ${command ?? '(none)'}.`);
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
