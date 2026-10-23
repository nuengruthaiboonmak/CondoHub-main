import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from './seed-common';

loadDotenv('.env.local');

const RUN_ID = 'docs01';
const BUILDING_CODE = 'DOCS-docs01';
const DAY_MS = 86_400_000;

interface DocsAccount {
  key: string;
  username: string;
  name: string;
  phone: string;
  isSystemAdmin: boolean;
}

const ACCOUNTS: DocsAccount[] = [
  { key: 'admin', username: 'docs01admin', name: 'Dana Admin', phone: '+66810101001', isSystemAdmin: true },
  { key: 'malee', username: 'docs01malee', name: 'Malee Kittisak', phone: '+66810101002', isSystemAdmin: false },
  { key: 'somchai', username: 'docs01somchai', name: 'Somchai Prasert', phone: '+66810101003', isSystemAdmin: false },
  { key: 'nattaya', username: 'docs01nattaya', name: 'Nattaya Chaiyan', phone: '+66810101004', isSystemAdmin: false },
  { key: 'arthit', username: 'docs01arthit', name: 'Arthit Wong', phone: '+66810101005', isSystemAdmin: false },
  { key: 'pimchan', username: 'docs01pimchan', name: 'Pimchan Loh', phone: '+66810101006', isSystemAdmin: false },
];

interface RoomSpec {
  key: string;
  code: string;
  name: string;
  areaSqm: string;
  floor: 'F7' | 'F8';
}

const ROOM_SPECS: RoomSpec[] = [
  { key: 'A701', code: 'DOCS-docs01-A701', name: 'A-701', areaSqm: '35.50', floor: 'F7' },
  { key: 'A702', code: 'DOCS-docs01-A702', name: 'A-702', areaSqm: '28.50', floor: 'F7' },
  { key: 'A703', code: 'DOCS-docs01-A703', name: 'A-703', areaSqm: '42.00', floor: 'F7' },
  { key: 'A801', code: 'DOCS-docs01-A801', name: 'A-801', areaSqm: '48.00', floor: 'F8' },
  { key: 'A802', code: 'DOCS-docs01-A802', name: 'A-802', areaSqm: '56.25', floor: 'F8' },
  { key: 'A803', code: 'DOCS-docs01-A803', name: 'A-803', areaSqm: '64.00', floor: 'F8' },
];

function seedActor(userId: string, isSystemAdmin: boolean) {
  return { userId, isSystemAdmin, accountStatus: 'ACTIVE' as const, mustChangePassword: false };
}

function bangkokDateParts(at: Date): { year: number; month: number; day: number } {
  const text = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  const parts = text.split('-');
  if (parts.length !== 3) throw new Error('Unexpected Bangkok date shape.');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error('Unexpected Bangkok date values.');
  }
  return { year, month, day };
}

function weekSchedule(open: Array<{ start: string; end: string }>) {
  const day = { open, breaks: [] as Array<{ start: string; end: string }> };
  return { '0': day, '1': day, '2': day, '3': day, '4': day, '5': day, '6': day };
}

async function main(): Promise<void> {
  assertSeedAllowed();
  const { db } = await import('@/shared/db/client');
  const { building } = await import('@/modules/property-membership/infrastructure/schema');
  const { eq } = await import('drizzle-orm');
  const present = await db
    .select({ id: building.id })
    .from(building)
    .where(eq(building.code, BUILDING_CODE))
    .limit(1);
  if (present.length > 0) {
    console.log(`docs-demo: building ${BUILDING_CODE} already exists, nothing to do.`);
    return;
  }
  const requestId = randomUUID();
  const identity = await import('@/modules/identity-access/application/index');
  const property = await import('@/modules/property-membership/application/index');
  const announcements = await import('@/modules/announcements/application/index');
  const booking = await import('@/modules/facility-booking/application/index');
  const billing = await import('@/modules/billing-payments/application/index');
  const maintenance = await import('@/modules/maintenance/application/index');
  const chat = await import('@/modules/room-chat/application/index');
  const identityCtx = identity.createIdentityCtx({ requestId, isSeedActor: true });
  const propertyCtx = property.createPropertyCtx({ requestId, isSeedActor: true });
  const announcementCtx = announcements.createAnnouncementCtx({ requestId, isSeedActor: true });
  const bookingCtx = booking.createBookingCtx({ requestId, isSeedActor: true });
  const billingCtx = billing.createBillingCtx({ requestId, isSeedActor: true });
  const maintenanceCtx = maintenance.createMaintenanceCtx({ requestId, isSeedActor: true });
  const chatCtx = chat.createChatCtx({ requestId, isSeedActor: true });
  const bootstrap = seedActor('seed-bootstrap', true);
  const userIds = new Map<string, string>();
  const passwords = new Map<string, string>();
  for (const account of ACCOUNTS) {
    const created = await identity.provisionSeedUser(
      bootstrap,
      {
        username: account.username,
        email: `${account.username}@example.invalid`,
        name: account.name,
        phone: account.phone,
        isSystemAdmin: account.isSystemAdmin,
        initialFlags: { mustChangePassword: false, accountStatus: 'ACTIVE' },
      },
      identityCtx,
    );
    userIds.set(account.key, created.userId);
    passwords.set(account.key, created.tempPassword);
  }
  const admin = seedActor(userIds.get('admin') ?? '', true);
  const nattaya = seedActor(userIds.get('nattaya') ?? '', false);
  const arthit = seedActor(userIds.get('arthit') ?? '', false);
  const projectId = randomUUID();
  property.wireRoomProvisioningPorts();
  const createdBuilding = await property.createBuilding(
    admin,
    { projectId, code: BUILDING_CODE, name: 'Sathorn Green Residence Tower A', status: 'ACTIVE' },
    propertyCtx,
  );
  const floor7 = await property.createFloor(
    admin,
    { buildingId: createdBuilding.id, code: 'DOCS-docs01-F7', label: 'Floor 7' },
    propertyCtx,
  );
  const floor8 = await property.createFloor(
    admin,
    { buildingId: createdBuilding.id, code: 'DOCS-docs01-F8', label: 'Floor 8' },
    propertyCtx,
  );
  const floors = { F7: floor7.id, F8: floor8.id } as const;
  const roomIds = new Map<string, string>();
  for (const spec of ROOM_SPECS) {
    const created = await property.createRoom(
      admin,
      {
        floorId: floors[spec.floor],
        buildingId: createdBuilding.id,
        roomCode: spec.code,
        name: spec.name,
        areaSqm: spec.areaSqm,
        status: 'ACTIVE',
      },
      propertyCtx,
    );
    roomIds.set(spec.key, created.id);
  }
  const roomId = (key: string): string => {
    const found = roomIds.get(key);
    if (found === undefined) throw new Error(`Missing room ${key}.`);
    return found;
  };
  const userId = (key: string): string => {
    const found = userIds.get(key);
    if (found === undefined) throw new Error(`Missing user ${key}.`);
    return found;
  };
  const ownershipStart = new Date('2023-01-01T00:00:00.000Z');
  await property.seedOwnership(admin, { roomId: roomId('A701'), userId: userId('malee'), startAt: ownershipStart }, propertyCtx);
  await property.seedOwnership(admin, { roomId: roomId('A702'), userId: userId('malee'), startAt: ownershipStart }, propertyCtx);
  await property.seedOwnership(admin, { roomId: roomId('A801'), userId: userId('somchai'), startAt: ownershipStart }, propertyCtx);
  const tenancyStart = new Date('2025-01-01T00:00:00.000Z');
  const tenancy701 = await property.createTenancy(
    admin,
    { roomId: roomId('A701'), startsAt: new Date(), endsAt: null, managementMode: 'PRIVATE_OWNER_MANAGED', effectiveAt: tenancyStart },
    propertyCtx,
  );
  await property.addMembership(
    admin,
    { roomId: roomId('A701'), userId: userId('nattaya'), memberRole: 'MAIN', tenancyId: tenancy701.id },
    propertyCtx,
  );
  const tenancy801 = await property.createTenancy(
    admin,
    { roomId: roomId('A801'), startsAt: new Date(), endsAt: null, managementMode: 'PROJECT_MANAGED', effectiveAt: tenancyStart },
    propertyCtx,
  );
  await property.addMembership(
    admin,
    { roomId: roomId('A801'), userId: userId('arthit'), memberRole: 'MAIN', tenancyId: tenancy801.id },
    propertyCtx,
  );
  await property.addMembership(
    admin,
    { roomId: roomId('A801'), userId: userId('pimchan'), memberRole: 'SUB', tenancyId: tenancy801.id },
    propertyCtx,
  );
  for (const key of ['A703', 'A802', 'A803']) {
    await property.createTenancy(
      admin,
      { roomId: roomId(key), startsAt: new Date(), endsAt: null, managementMode: 'PROJECT_MANAGED', effectiveAt: tenancyStart },
      propertyCtx,
    );
  }
  const now = Date.now();
  await announcements.seedAnnouncement(
    admin,
    {
      title: 'Songkran water-use notice',
      body: 'During the Songkran festival from 13 to 15 April, please use water mindfully in the common areas. Water stations are available on the ground floor from 9 in the morning until 5 in the evening.',
      publishAt: new Date(now - 2 * DAY_MS),
      authorId: admin.userId,
    },
    announcementCtx,
  );
  await announcements.seedAnnouncement(
    admin,
    {
      title: 'Elevator maintenance Saturday',
      body: 'The Tower A passenger elevator will be serviced this Saturday from 10 in the morning until 2 in the afternoon. Please use the service elevator during that time. We apologize for the inconvenience.',
      publishAt: new Date(now - DAY_MS),
      authorId: admin.userId,
    },
    announcementCtx,
  );
  const freshNotices = [
    {
      title: 'Sky Pool deep clean on Sunday',
      body: 'The Sky Pool closes this Sunday from 9 in the morning until noon for its monthly deep clean. The Fitness Room stays open as usual. Thank you for your understanding.',
    },
    {
      title: 'Parcel room holiday hours',
      body: 'During the public holiday the parcel room opens from 9 in the morning until 5 in the evening. Please collect large parcels within three days so the shelves stay clear for everyone.',
    },
    {
      title: 'Visitor parking registration',
      body: 'From next month, please register visitor cars at the lobby desk before 8 in the evening. Each room may register up to two cars per night. Unregistered cars may be wheel-clamped.',
    },
  ];
  for (const [index, notice] of freshNotices.entries()) {
    await announcements.seedAnnouncement(
      admin,
      {
        title: notice.title,
        body: notice.body,
        publishAt: new Date(now - index * 60_000),
        authorId: admin.userId,
      },
      announcementCtx,
    );
  }
  const configEffectiveAt = new Date('2025-01-01T00:00:00.000Z');
  const pool = await booking.seedFacility(
    admin,
    {
      projectId,
      code: 'DOCS-docs01-POOL',
      name: 'Sky Pool',
      description: 'Rooftop swimming pool with city views. Please shower before entering and keep noise down after 9 in the evening.',
      status: 'ACTIVE',
      capacity: 12,
      schedule: { days: weekSchedule([{ start: '06:00', end: '22:00' }]), holidays: [] },
      slotMinutes: 60,
      quotaKind: 'WEEKLY',
      quotaLimit: 3,
      advanceDays: 14,
      effectiveAt: configEffectiveAt,
    },
    bookingCtx,
  );
  await booking.seedFacility(
    admin,
    {
      projectId,
      code: 'DOCS-docs01-GYM',
      name: 'Fitness Room',
      description: 'Shared fitness room with cardio machines and free weights. Please wipe down equipment after use.',
      status: 'ACTIVE',
      capacity: 8,
      schedule: { days: weekSchedule([{ start: '08:00', end: '20:00' }]), holidays: [] },
      slotMinutes: 60,
      quotaKind: 'WEEKLY',
      quotaLimit: 3,
      advanceDays: 14,
      effectiveAt: configEffectiveAt,
    },
    bookingCtx,
  );
  const slotDay = bangkokDateParts(new Date(now + 3 * DAY_MS));
  const slotStart = new Date(Date.UTC(slotDay.year, slotDay.month - 1, slotDay.day, 3, 0, 0));
  const slotEnd = new Date(slotStart.getTime() + 3_600_000);
  await booking.seedDirectBooking(
    admin,
    {
      facilityId: pool.facilityId,
      roomId: roomId('A701'),
      createdBy: userId('nattaya'),
      slots: [{ startsAt: slotStart, endsAt: slotEnd }],
    },
    bookingCtx,
  );
  for (const spec of ROOM_SPECS) {
    await billing.seedBillingRule(
      admin,
      {
        kind: 'COMMON_FEE',
        roomId: roomId(spec.key),
        configMode: 'FIXED_PROJECT',
        rate: '2500.00',
        frequency: 'MONTHLY',
        effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
      },
      billingCtx,
    );
  }
  for (const spec of ROOM_SPECS) {
    await billing.seedPayeeInstruction(
      admin,
      {
        payeeType: 'PROJECT',
        payeeId: roomId(spec.key),
        bankName: 'Bangkok Bank',
        accountName: 'Sathorn Green Residence Juristic Person (Demo)',
        accountNumber: '123-4-56789-0',
        effectiveFrom: new Date('2023-01-01T00:00:00.000Z'),
      },
      billingCtx,
    );
  }
  const event = await billing.seedChargeEvent(
    admin,
    {
      eventEffectiveDate: '2026-10-05',
      configuredAmountSatang: 150000n,
      chargeContext: { note: 'Lobby renovation contribution for Tower A common areas.' },
      runId: RUN_ID,
    },
    billingCtx,
  );
  const issuance = await billing.issueCommonFeeEvent(
    admin,
    event.id,
    { roomIds: ROOM_SPECS.map((spec) => roomId(spec.key)) },
    billingCtx,
  );
  let payment: 'submitted' | 'skipped' = 'skipped';
  console.log('docs-demo: payment skipped (submitPayment requires a slip image owned by the payer, seed images belong to the admin).');
  const lobbyTicket = await maintenance.createTicket(
    nattaya,
    {
      routingKind: 'COMMON_AREA',
      locationDescription: 'Tower A lobby near the elevators',
      subject: 'Lobby ceiling light flickers at night',
      description: 'One ceiling light in the Tower A lobby flickers after dark. It started earlier this week and makes the entrance feel unsafe at night.',
      idempotencyKey: randomUUID(),
    },
    maintenanceCtx,
  );
  await maintenance.postTicketComment(
    nattaya,
    lobbyTicket.id,
    { body: 'The flickering is worse tonight. Happy to show the technician the exact spot.', idempotencyKey: randomUUID() },
    maintenanceCtx,
  );
  const sinkTicket = await maintenance.createTicket(
    nattaya,
    {
      routingKind: 'PRIVATE_OWNER',
      roomId: roomId('A701'),
      locationDescription: 'Kitchen',
      subject: 'Kitchen sink drains slowly',
      description: 'The kitchen sink in A-701 drains very slowly and has a mild odor in the evenings. We have tried a plunger with no improvement.',
      idempotencyKey: randomUUID(),
    },
    maintenanceCtx,
  );
  await maintenance.postTicketComment(
    nattaya,
    sinkTicket.id,
    { body: 'The building plumber is welcome to visit after 6 in the evening on weekdays.', idempotencyKey: randomUUID() },
    maintenanceCtx,
  );
  const acTicket = await maintenance.createTicket(
    arthit,
    {
      routingKind: 'PROJECT_MANAGED_PRIVATE',
      roomId: roomId('A801'),
      locationDescription: 'Bedroom',
      subject: 'Air conditioner makes a loud noise',
      description: 'The bedroom air conditioner in A-801 rattles loudly when it starts. It still cools the room, but the noise wakes us at night.',
      idempotencyKey: randomUUID(),
    },
    maintenanceCtx,
  );
  await maintenance.postTicketComment(
    arthit,
    acTicket.id,
    { body: 'The noise happens every time the compressor kicks in, roughly every half hour.', idempotencyKey: randomUUID() },
    maintenanceCtx,
  );
  await chat.sendMessage(
    nattaya,
    { roomId: roomId('A701'), clientMessageId: randomUUID(), text: 'Hello, we just moved into A-701. Could you confirm the parcel room hours?' },
    chatCtx,
  );
  await chat.sendMessage(
    admin,
    { roomId: roomId('A701'), clientMessageId: randomUUID(), text: 'Welcome to Sathorn Green Residence. The parcel room is open daily from 8 in the morning until 8 in the evening.' },
    chatCtx,
  );
  await chat.sendMessage(
    nattaya,
    { roomId: roomId('A701'), clientMessageId: randomUUID(), text: 'Thank you. Is the Sky Pool open on public holidays?' },
    chatCtx,
  );
  await chat.sendMessage(
    nattaya,
    { roomId: roomId('A701'), clientMessageId: randomUUID(), text: 'Also, where should we report a flickering light in the lobby?' },
    chatCtx,
  );
  console.log('docs-demo: users');
  for (const account of ACCOUNTS) {
    console.log(`docs-demo: username=${account.username} password=${passwords.get(account.key) ?? ''} name=${account.name}`);
  }
  console.log(
    `docs-demo: created building=1 floors=2 rooms=6 ownerships=3 tenancies=5 memberships=3 announcements=5 facilities=2 bookings=1 billingRules=6 payeeInstructions=6 chargeEvents=1 tickets=3 ticketComments=3 chatMessages=4`,
  );
  console.log(
    `docs-demo: issuance created=${issuance.created} skipped=${issuance.skipped} remaining=${issuance.remaining} issued=${issuance.issued} status=${issuance.status} errors=${issuance.errors.length} payment=${payment}`,
  );
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
