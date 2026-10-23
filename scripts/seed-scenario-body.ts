import { randomUUID } from 'node:crypto';
import type { Actor } from '@/shared/auth/actor';
import {
  createIdentityCtx,
  provisionSeedUser,
} from '@/modules/identity-access/application/index';
import {
  addMembership,
  createBuilding,
  createFloor,
  createPropertyCtx,
  createRoom,
  createTenancy,
  endMembershipAt,
  endTenancyAt,
  grantCoOwner,
  listRoomActiveTenancies,
  seedOwnership,
  transferOwnership,
  wireRoomProvisioningPorts,
} from '@/modules/property-membership/application/index';
import {
  createAnnouncementCtx,
  seedAnnouncement,
  updateAnnouncementEntry,
} from '@/modules/announcements/application/index';
import {
  createMediaCtx,
  seedReadyImage,
  seedStaleImage,
} from '@/modules/media-attachments/application/index';
import {
  createBookingCtx,
  seedBooking,
  seedCancelSlot,
  seedDirectBooking,
  seedFacility,
} from '@/modules/facility-booking/application/index';
import {
  createBillingCtx,
  seedBillingRule,
  seedChargeEvent,
  seedPayeeInstruction,
} from '@/modules/billing-payments/application/index';
import {
  createChatCtx,
  sendMessage,
  type ChatCtx,
} from '@/modules/room-chat/application/index';

const LONG_TEXT =
  'Maple Residences Tower of Enduring Harmony and Perpetual Serenity by the Riverside Gardens Extension Block C Wing D Unit Corridor North';

interface SeedAccount {
  key: string;
  name: string;
  isSystemAdmin: boolean;
  mustChangePassword: boolean;
  accountStatus: 'ACTIVE' | 'SUSPENDED';
}

const ACCOUNTS: SeedAccount[] = [
  { key: 'admin', name: 'Scenario Admin', isSystemAdmin: true, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'ownera', name: 'Amara Owner', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'ownerc', name: 'Chai Coowner', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'ownernewb', name: 'Bima Newowner', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'maint', name: 'Mali Main', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'subt', name: 'Somsak Sub', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'privt', name: 'Pim Private', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'formert', name: 'Fah Former', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'formerowner', name: 'Nok Formerowner', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'noaccess', name: 'Noa Noaccess', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'ACTIVE' },
  { key: 'suspended', name: 'Sak Suspended', isSystemAdmin: false, mustChangePassword: false, accountStatus: 'SUSPENDED' },
  { key: 'freshuser', name: 'Fai Fresh', isSystemAdmin: false, mustChangePassword: true, accountStatus: 'ACTIVE' },
];

function seedActor(userId: string, isSystemAdmin: boolean): Actor {
  return { userId, isSystemAdmin, accountStatus: 'ACTIVE', mustChangePassword: false };
}

function backdate(monthsAgo: number): Date {
  const at = new Date();
  at.setUTCMonth(at.getUTCMonth() - monthsAgo);
  return at;
}

export async function runPropertyScenario(runId: string): Promise<void> {
  wireRoomProvisioningPorts();
  const safeRun = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const requestId = randomUUID();
  const identityCtx = createIdentityCtx({ requestId, isSeedActor: true });
  const propertyCtx = createPropertyCtx({ requestId, isSeedActor: true });
  const bootstrap = seedActor('seed-bootstrap', true);
  const userIds = new Map<string, string>();
  for (const [index, account] of ACCOUNTS.entries()) {
    const username = `e2e${safeRun}${account.key}`.slice(0, 30);
    const result = await provisionSeedUser(
      bootstrap,
      {
        username,
        email: `${username}@example.invalid`,
        name: account.key === 'ownera' ? LONG_TEXT : account.name,
        phone: `+6600000${String(1000 + index)}`,
        isSystemAdmin: account.isSystemAdmin,
        initialFlags: {
          mustChangePassword: account.mustChangePassword,
          accountStatus: account.accountStatus,
        },
      },
      identityCtx,
    );
    userIds.set(account.key, result.userId);
    console.log(`seed ${runId} ${account.key} tempPassword=${result.tempPassword}`);
  }
  const admin = seedActor(userIds.get('admin') ?? '', true);
  const ownerA = seedActor(userIds.get('ownera') ?? '', false);
  const ownerAId = userIds.get('ownera') ?? '';
  const ownerCId = userIds.get('ownerc') ?? '';
  const building = await createBuilding(
    admin,
    {
      projectId: randomUUID(),
      code: `E2E-${runId}`.slice(0, 64),
      name: `E2E Building ${runId} ${LONG_TEXT}`.slice(0, 255),
      status: 'ACTIVE',
    },
    propertyCtx,
  );
  const floor = await createFloor(
    admin,
    { buildingId: building.id, code: `F1-${safeRun}`, label: `Floor 1 ${runId}` },
    propertyCtx,
  );
  const rooms = new Map<string, string>();
  for (const code of ['101', '102', '103', '104', '105']) {
    const room = await createRoom(
      admin,
      {
        floorId: floor.id,
        buildingId: building.id,
        roomCode: `E2E-${runId}-${code}`,
        areaSqm: code === '105' ? '120.50' : '35.50',
        status: 'ACTIVE',
      },
      propertyCtx,
    );
    rooms.set(code, room.id);
  }
  const room101 = rooms.get('101') ?? '';
  const room102 = rooms.get('102') ?? '';
  const room103 = rooms.get('103') ?? '';
  const room104 = rooms.get('104') ?? '';
  const room105 = rooms.get('105') ?? '';
  await seedOwnership(admin, { roomId: room101, userId: ownerAId, startAt: backdate(8) }, propertyCtx);
  await grantCoOwner(ownerA, { roomId: room101, userId: ownerCId }, propertyCtx);
  const tenancy101 = await createTenancy(
    ownerA,
    { roomId: room101, startsAt: backdate(6), endsAt: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
    propertyCtx,
  );
  await addMembership(
    ownerA,
    { roomId: room101, userId: userIds.get('privt') ?? '', memberRole: 'MAIN', tenancyId: tenancy101.id },
    propertyCtx,
  );
  const tenancy102 = await createTenancy(
    admin,
    { roomId: room102, startsAt: backdate(6), endsAt: null, managementMode: 'PROJECT_MANAGED' },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room102, userId: userIds.get('maint') ?? '', memberRole: 'MAIN', tenancyId: tenancy102.id },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room102, userId: userIds.get('subt') ?? '', memberRole: 'SUB', tenancyId: tenancy102.id },
    propertyCtx,
  );
  const endedTenancy = await createTenancy(
    admin,
    { roomId: room104, startsAt: backdate(3), endsAt: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
    propertyCtx,
  );
  const formerMember = await addMembership(
    admin,
    { roomId: room104, userId: userIds.get('formert') ?? '', memberRole: 'MAIN', tenancyId: endedTenancy.id },
    propertyCtx,
  );
  await endMembershipAt(admin, { roomId: room104, membershipId: formerMember.id }, propertyCtx);
  await endTenancyAt(admin, { tenancyId: endedTenancy.id }, propertyCtx);
  await createTenancy(
    admin,
    { roomId: room104, startsAt: new Date(), endsAt: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
    propertyCtx,
  );
  await seedOwnership(
    admin,
    { roomId: room103, userId: userIds.get('formerowner') ?? '', startAt: backdate(10) },
    propertyCtx,
  );
  await transferOwnership(
    admin,
    {
      roomId: room103,
      fromUserId: userIds.get('formerowner') ?? '',
      toUserId: ownerAId,
      effectiveAt: backdate(2),
    },
    propertyCtx,
  );
  await seedOwnership(admin, { roomId: room105, userId: ownerAId, startAt: backdate(9) }, propertyCtx);
  await transferOwnership(
    admin,
    {
      roomId: room105,
      fromUserId: ownerAId,
      toUserId: userIds.get('ownernewb') ?? '',
      effectiveAt: backdate(1),
    },
    propertyCtx,
  );
  await runAnnouncementScenario(runId, requestId, admin);
  await runOrphanSweepScenario(runId, requestId, admin);
  await runBookingScenario(
    runId,
    requestId,
    admin,
    building.projectId,
    rooms,
    userIds.get('privt') ?? '',
  );
  const billingUsers = new Map<string, string>();
  for (const key of ['ownera', 'ownerc', 'ownernewb']) {
    billingUsers.set(key, userIds.get(key) ?? '');
  }
  await runBillingScenario(
    runId,
    requestId,
    admin,
    { buildingId: building.id, floorId: floor.id },
    billingUsers,
  );
  await runMaintenanceScenario(
    runId,
    requestId,
    admin,
    { buildingId: building.id, floorId: floor.id },
    userIds,
  );
  await runChatScenario(
    runId,
    requestId,
    admin,
    { buildingId: building.id, floorId: floor.id },
    userIds,
  );
  console.log(`Scenario seed complete for run ${runId}.`);
}

async function runAnnouncementScenario(runId: string, requestId: string, admin: Actor): Promise<void> {
  const { default: sharp } = await import('sharp');
  const announcementCtx = createAnnouncementCtx({ requestId, isSeedActor: true });
  const mediaCtx = createMediaCtx({ requestId, isSeedActor: true });
  const adminId = admin.userId;
  const now = Date.now();
  const dayMs = 86_400_000;
  await seedAnnouncement(
    admin,
    {
      title: `E2E-${runId} draft notice`,
      body: `This draft is invisible to residents. Run ${runId}.`,
      publishAt: null,
      authorId: adminId,
    },
    announcementCtx,
  );
  await seedAnnouncement(
    admin,
    {
      title: `E2E-${runId} scheduled notice`,
      body: `Scheduled one week out. Run ${runId}.`,
      publishAt: new Date(now + 7 * dayMs),
      authorId: adminId,
    },
    announcementCtx,
  );
  const tinyPng = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#4f8f4f' },
  })
    .png()
    .toBuffer();
  const seedImages: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const seeded = await seedReadyImage(
      admin,
      {
        runId,
        fileName: `seed-cap-${index}.png`,
        scope: 'ANNOUNCEMENT',
        mime: 'image/png',
        bytes: tinyPng,
        width: 8,
        height: 8,
      },
      mediaCtx,
    );
    seedImages.push(seeded.imageId);
  }
  const published = await seedAnnouncement(
    admin,
    {
      title: `E2E-${runId} published notice`,
      body: `Visible to every active account. Run ${runId}.`,
      publishAt: new Date(now - dayMs),
      authorId: adminId,
    },
    announcementCtx,
  );
  await updateAnnouncementEntry(
    admin,
    published.announcementId,
    { imageIds: seedImages },
    { ...announcementCtx, isSeedActor: false },
  );
  const longBody = `${LONG_TEXT}. Run ${runId}. ${LONG_TEXT}.`;
  const longPublished = await seedAnnouncement(
    admin,
    {
      title: `E2E-${runId} ${LONG_TEXT}`.slice(0, 255),
      body: longBody.slice(0, 20000),
      publishAt: new Date(now - 2 * dayMs),
      authorId: adminId,
    },
    announcementCtx,
  );
  await updateAnnouncementEntry(
    admin,
    longPublished.announcementId,
    { body: `${longBody} Edited after publish.`.slice(0, 20000) },
    { ...announcementCtx, isSeedActor: false },
  );
  await seedAnnouncement(
    admin,
    {
      title: `E2E-${runId} hidden notice`,
      body: `Hidden after publish. Run ${runId}.`,
      publishAt: new Date(now - 3 * dayMs),
      hiddenAt: new Date(now - dayMs),
      authorId: adminId,
    },
    announcementCtx,
  );
  const capProbePng = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#3f6fbf' },
  })
    .png()
    .toBuffer();
  await seedReadyImage(
    admin,
    {
      runId,
      fileName: 'seed-extra-6th.png',
      scope: 'ANNOUNCEMENT',
      mime: 'image/png',
      bytes: capProbePng,
      width: 8,
      height: 8,
    },
    mediaCtx,
  );
  console.log(`Announcement seed complete for run ${runId}.`);
}

async function runOrphanSweepScenario(runId: string, requestId: string, admin: Actor): Promise<void> {
  const { default: sharp } = await import('sharp');
  const mediaCtx = createMediaCtx({ requestId, isSeedActor: true });
  const now = Date.now();
  const hourMs = 3_600_000;
  const tinyPng = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#8f4f4f' },
  })
    .png()
    .toBuffer();
  const staleInput = {
    runId,
    mime: 'image/png' as const,
    bytes: tinyPng,
    width: 8,
    height: 8,
  };
  await seedStaleImage(
    admin,
    {
      ...staleInput,
      fileName: 'sweep-stale-pending.png',
      scope: 'CHAT',
      createdAt: new Date(now - 2 * hourMs),
      ready: false,
    },
    mediaCtx,
  );
  await seedStaleImage(
    admin,
    {
      ...staleInput,
      fileName: 'sweep-aged-pending.png',
      scope: 'CHAT',
      createdAt: new Date(now - 25 * hourMs),
      ready: false,
    },
    mediaCtx,
  );
  await seedStaleImage(
    admin,
    {
      ...staleInput,
      fileName: 'sweep-aged-ready.png',
      scope: 'MAINTENANCE',
      createdAt: new Date(now - 25 * hourMs),
      ready: true,
    },
    mediaCtx,
  );
  await seedStaleImage(
    admin,
    {
      ...staleInput,
      fileName: 'sweep-young-pending.png',
      scope: 'CHAT',
      createdAt: new Date(now - 5 * 60_000),
      ready: false,
    },
    mediaCtx,
  );
  const attached = await seedStaleImage(
    admin,
    {
      ...staleInput,
      fileName: 'sweep-attached-control.png',
      scope: 'ANNOUNCEMENT',
      createdAt: new Date(now - 48 * hourMs),
      ready: true,
    },
    mediaCtx,
  );
  const announcementCtx = createAnnouncementCtx({ requestId, isSeedActor: true });
  const control = await seedAnnouncement(
    admin,
    {
      title: `E2E-${runId} sweep control notice`,
      body: `Attached control for the orphan sweeper. Run ${runId}.`,
      publishAt: new Date(now - hourMs),
      authorId: admin.userId,
    },
    announcementCtx,
  );
  await updateAnnouncementEntry(
    admin,
    control.announcementId,
    { imageIds: [attached.imageId] },
    { ...announcementCtx, isSeedActor: false },
  );
  console.log(`Orphan sweep seed complete for run ${runId}.`);
}

async function runBookingScenario(
  runId: string,
  requestId: string,
  admin: Actor,
  projectId: string,
  rooms: Map<string, string>,
  createdBy: string,
): Promise<void> {
  const bookingCtx = createBookingCtx({ requestId, isSeedActor: true });
  const now = Date.now();
  const dayMs = 86_400_000;
  const buildDays = (
    build: (day: string) => { open: Array<{ start: string; end: string }>; breaks: Array<{ start: string; end: string }> },
  ): Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', { open: Array<{ start: string; end: string }>; breaks: Array<{ start: string; end: string }> }> => ({
    '0': build('0'),
    '1': build('1'),
    '2': build('2'),
    '3': build('3'),
    '4': build('4'),
    '5': build('5'),
    '6': build('6'),
  });
  const openDays = buildDays((day) =>
    day === '0'
      ? { open: [], breaks: [] }
      : { open: [{ start: '08:00', end: '20:00' }], breaks: [{ start: '12:00', end: '13:00' }] },
  );
  const wideDays = buildDays(() => ({ open: [{ start: '00:00', end: '24:00' }], breaks: [] }));
  const room102 = rooms.get('102') ?? '';
  await seedFacility(
    admin,
    {
      projectId,
      code: `E2E-${runId}-POOL`,
      name: `E2E ${runId} Lap Pool`,
      description: `Eight-lane lap pool seeded for run ${runId}.`,
      status: 'ACTIVE',
      capacity: 2,
      schedule: { days: openDays, holidays: [] },
      slotMinutes: 60,
      quotaKind: 'DAILY',
      quotaLimit: 2,
      advanceDays: 30,
      effectiveAt: new Date(now - 7 * dayMs),
      pending: {
        schedule: { days: openDays, holidays: [] },
        slotMinutes: 60,
        quotaKind: 'DAILY',
        quotaLimit: 3,
        advanceDays: 30,
        effectiveAt: new Date(now + 30 * dayMs),
      },
      closures: [
        {
          startsAt: new Date(now + 3 * dayMs),
          endsAt: new Date(now + 3 * dayMs + 2 * 3_600_000),
          reason: `E2E-${runId} pump maintenance window`,
        },
      ],
    },
    bookingCtx,
  );
  const longHall = await seedFacility(
    admin,
    {
      projectId,
      code: `E2E-${runId}-HALL`,
      name: `E2E ${runId} ${LONG_TEXT}`.slice(0, 255),
      description: `${LONG_TEXT} Run ${runId}. ${LONG_TEXT}`.slice(0, 20000),
      status: 'ACTIVE',
      capacity: 1,
      schedule: { days: openDays, holidays: [] },
      slotMinutes: 60,
      quotaKind: 'WEEKLY',
      quotaLimit: 5,
      advanceDays: 30,
      effectiveAt: new Date(now - 7 * dayMs),
    },
    bookingCtx,
  );
  const midnightStudio = await seedFacility(
    admin,
    {
      projectId,
      code: `E2E-${runId}-STUDIO`,
      name: `E2E ${runId} Midnight Studio`,
      description: `Open around the clock for midnight-boundary probes. Run ${runId}.`,
      status: 'ACTIVE',
      capacity: 1,
      schedule: { days: wideDays, holidays: [] },
      slotMinutes: 60,
      quotaKind: 'DAILY',
      quotaLimit: 4,
      advanceDays: 30,
      effectiveAt: new Date(now - 7 * dayMs),
    },
    bookingCtx,
  );
  const bangkokToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now + 2 * dayMs));
  const [yearText, monthText, dayText] = bangkokToday.split('-') as [string, string, string];
  const atLocal = (hour: number, minute: number): Date =>
    new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText), hour - 7, minute));
  const triple = await seedDirectBooking(
    admin,
    {
      facilityId: longHall.facilityId,
      roomId: room102,
      createdBy,
      slots: [
        { startsAt: atLocal(9, 0), endsAt: atLocal(10, 0) },
        { startsAt: atLocal(10, 0), endsAt: atLocal(11, 0) },
        { startsAt: atLocal(14, 0), endsAt: atLocal(15, 0) },
      ],
    },
    bookingCtx,
  );
  const { toPeriodKey } = await import('@/shared/utils/clock');
  const weeklyKey = toPeriodKey(atLocal(10, 0), 'WEEKLY');
  await seedCancelSlot(
    admin,
    {
      bookingId: triple.bookingId,
      slotId: triple.slotIds[1] ?? '',
      refundQuota: false,
      reason: `E2E-${runId} resident cancels the middle slot`,
      periodKey: weeklyKey,
      roomId: room102,
      facilityId: longHall.facilityId,
      admin: false,
    },
    bookingCtx,
  );
  const refunded = await seedDirectBooking(
    admin,
    {
      facilityId: longHall.facilityId,
      roomId: room102,
      createdBy,
      slots: [{ startsAt: atLocal(15, 0), endsAt: atLocal(16, 0) }],
    },
    bookingCtx,
  );
  await seedCancelSlot(
    admin,
    {
      bookingId: refunded.bookingId,
      slotId: refunded.slotIds[0] ?? '',
      refundQuota: true,
      reason: `E2E-${runId} admin refunds one slot`,
      periodKey: weeklyKey,
      roomId: room102,
      facilityId: longHall.facilityId,
      admin: true,
    },
    bookingCtx,
  );
  const probeStart = new Date(now + 2 * dayMs);
  probeStart.setUTCMinutes(0, 0, 0);
  await seedBooking(
    admin,
    midnightStudio.facilityId,
    { roomId: room102, startsAt: [probeStart.toISOString()] },
    bookingCtx,
  );
  console.log(`Booking seed complete for run ${runId}.`);
}

async function runBillingScenario(
  runId: string,
  requestId: string,
  admin: Actor,
  structures: { buildingId: string; floorId: string },
  userIds: Map<string, string>,
): Promise<void> {
  const propertyCtx = createPropertyCtx({ requestId, isSeedActor: true });
  const billingCtx = createBillingCtx({ requestId, isSeedActor: true });
  const ownerA = userIds.get('ownera') ?? '';
  const ownerC = userIds.get('ownerc') ?? '';
  const ownerNewB = userIds.get('ownernewb') ?? '';
  const roomSpecs = [
    { code: '201', areaSqm: '35.50', owner: ownerC },
    { code: '202', areaSqm: '42.00', owner: ownerA },
    { code: '203', areaSqm: '35.50', owner: ownerNewB },
    { code: '204', areaSqm: '120.50', owner: ownerC },
    { code: '205', areaSqm: '50.00', owner: null },
    { code: '206', areaSqm: '40.00', owner: ownerA },
    { code: '207', areaSqm: '40.00', owner: ownerA },
    { code: '208', areaSqm: '60.00', owner: ownerC },
    { code: '209', areaSqm: '45.00', owner: null },
    { code: '210', areaSqm: '40.00', owner: ownerA },
    { code: '211', areaSqm: '40.00', owner: ownerA },
    { code: '212', areaSqm: '40.00', owner: ownerA },
    { code: '213', areaSqm: '45.00', owner: ownerA },
  ] as const;
  const rooms = new Map<string, string>();
  for (const spec of roomSpecs) {
    const room = await createRoom(
      admin,
      {
        floorId: structures.floorId,
        buildingId: structures.buildingId,
        roomCode: `E2E-${runId}-${spec.code}`,
        areaSqm: spec.areaSqm,
        status: 'ACTIVE',
      },
      propertyCtx,
    );
    rooms.set(spec.code, room.id);
    if (spec.owner !== null) {
      await seedOwnership(
        admin,
        { roomId: room.id, userId: spec.owner, startAt: new Date('2023-01-01T00:00:00.000Z') },
        propertyCtx,
      );
    }
  }
  const room201 = rooms.get('201') ?? '';
  const room202 = rooms.get('202') ?? '';
  const room204 = rooms.get('204') ?? '';
  const room205 = rooms.get('205') ?? '';
  const room206 = rooms.get('206') ?? '';
  const room207 = rooms.get('207') ?? '';
  const room208 = rooms.get('208') ?? '';
  const room209 = rooms.get('209') ?? '';
  await seedOwnership(
    admin,
    { roomId: room206, userId: ownerC, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await seedOwnership(
    admin,
    { roomId: room207, userId: ownerC, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  const room210 = rooms.get('210') ?? '';
  const room211 = rooms.get('211') ?? '';
  const room212 = rooms.get('212') ?? '';
  const room213 = rooms.get('213') ?? '';
  await seedOwnership(
    admin,
    { roomId: room210, userId: ownerC, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room205,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room201,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room202,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  const turnover206First = await createTenancy(
    admin,
    {
      roomId: room206,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await endTenancyAt(
    admin,
    { tenancyId: turnover206First.id, endsAt: new Date('2026-06-16T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room206,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2026-06-16T00:00:00.000Z'),
    },
    propertyCtx,
  );
  const turnover207First = await createTenancy(
    admin,
    {
      roomId: room207,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await endTenancyAt(
    admin,
    { tenancyId: turnover207First.id, endsAt: new Date('2026-06-16T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room207,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2026-06-16T00:00:00.000Z'),
    },
    propertyCtx,
  );
  const turnover208First = await createTenancy(
    admin,
    {
      roomId: room208,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await endTenancyAt(
    admin,
    { tenancyId: turnover208First.id, endsAt: new Date('2026-06-16T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room208,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2026-06-16T00:00:00.000Z'),
    },
    propertyCtx,
  );
  const turnover209First = await createTenancy(
    admin,
    {
      roomId: room209,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await endTenancyAt(
    admin,
    { tenancyId: turnover209First.id, endsAt: new Date('2026-06-16T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room209,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2026-06-16T00:00:00.000Z'),
    },
    propertyCtx,
  );
  const turnoverFirst = await createTenancy(
    admin,
    {
      roomId: room204,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await endTenancyAt(
    admin,
    { tenancyId: turnoverFirst.id, endsAt: new Date('2026-02-15T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room204,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2026-02-15T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room210,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2026-12-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room211,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2026-12-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room212,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2026-12-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room213,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2026-12-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  const ruleEffectiveAt = new Date('2020-01-01T00:00:00.000Z');
  const paymentsRuleEffectiveAt = new Date('2026-11-15T00:00:00.000Z');
  await seedBillingRule(
    admin,
    {
      kind: 'PROJECT_MANAGED_RENT',
      roomId: room201,
      configMode: 'FIXED_PROJECT',
      rate: '8000.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: room201,
      configMode: 'AREA',
      rate: '70.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: room201,
      configMode: 'FIXED_PROJECT',
      rate: '9000.00',
      frequency: 'QUARTERLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PRIVATE_RENT',
      roomId: room202,
      configMode: 'FIXED_PROJECT',
      rate: '12000.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: room202,
      configMode: 'FIXED_PROJECT',
      rate: '3000.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: rooms.get('203') ?? '',
      configMode: 'FIXED_PROJECT',
      rate: '3000.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PROJECT_MANAGED_RENT',
      roomId: room204,
      configMode: 'FIXED_PROJECT',
      rate: '8000.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: room204,
      configMode: 'PER_ROOM',
      rate: '2500.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: room205,
      configMode: 'FIXED_PROJECT',
      rate: '1500.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PRIVATE_RENT',
      roomId: room206,
      configMode: 'FIXED_PROJECT',
      rate: '12000.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PRIVATE_RENT',
      roomId: room207,
      configMode: 'FIXED_PROJECT',
      rate: '12000.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PROJECT_MANAGED_RENT',
      roomId: room208,
      configMode: 'FIXED_PROJECT',
      rate: '8000.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PROJECT_MANAGED_RENT',
      roomId: room209,
      configMode: 'FIXED_PROJECT',
      rate: '8000.00',
      frequency: 'MONTHLY',
      effectiveAt: ruleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PRIVATE_RENT',
      roomId: room210,
      configMode: 'FIXED_PROJECT',
      rate: '10000.00',
      frequency: 'MONTHLY',
      effectiveAt: paymentsRuleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: room210,
      configMode: 'FIXED_PROJECT',
      rate: '3000.00',
      frequency: 'MONTHLY',
      effectiveAt: paymentsRuleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PRIVATE_RENT',
      roomId: room211,
      configMode: 'FIXED_PROJECT',
      rate: '12000.00',
      frequency: 'MONTHLY',
      effectiveAt: paymentsRuleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: room211,
      configMode: 'FIXED_PROJECT',
      rate: '3000.00',
      frequency: 'MONTHLY',
      effectiveAt: paymentsRuleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PRIVATE_RENT',
      roomId: room212,
      configMode: 'FIXED_PROJECT',
      rate: '12000.00',
      frequency: 'MONTHLY',
      effectiveAt: paymentsRuleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: room212,
      configMode: 'FIXED_PROJECT',
      rate: '3000.00',
      frequency: 'MONTHLY',
      effectiveAt: paymentsRuleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'PROJECT_MANAGED_RENT',
      roomId: room213,
      configMode: 'FIXED_PROJECT',
      rate: '8000.00',
      frequency: 'MONTHLY',
      effectiveAt: paymentsRuleEffectiveAt,
    },
    billingCtx,
  );
  await seedBillingRule(
    admin,
    {
      kind: 'COMMON_FEE',
      roomId: room213,
      configMode: 'PER_ROOM',
      rate: '2500.00',
      frequency: 'MONTHLY',
      effectiveAt: paymentsRuleEffectiveAt,
    },
    billingCtx,
  );
  const payeeEffectiveAt = new Date('2023-01-01T00:00:00.000Z');
  await seedPayeeInstruction(
    admin,
    {
      payeeType: 'OWNER',
      payeeId: room206,
      bankName: 'E2E Test Bank',
      accountName: 'Amara Original Owner',
      accountNumber: '206-0-00001-9',
      effectiveFrom: payeeEffectiveAt,
    },
    billingCtx,
  );
  await seedPayeeInstruction(
    admin,
    {
      payeeType: 'OWNER',
      payeeId: room207,
      bankName: 'E2E Test Bank',
      accountName: 'Amara Original Owner',
      accountNumber: '207-0-00001-9',
      effectiveFrom: payeeEffectiveAt,
    },
    billingCtx,
  );
  await seedPayeeInstruction(
    admin,
    {
      payeeType: 'PROJECT',
      payeeId: room208,
      bankName: 'E2E Test Bank',
      accountName: 'CondoHub Project Account',
      accountNumber: '208-0-00001-9',
      effectiveFrom: payeeEffectiveAt,
    },
    billingCtx,
  );
  await seedPayeeInstruction(
    admin,
    {
      payeeType: 'PROJECT',
      payeeId: room209,
      bankName: 'E2E Test Bank',
      accountName: 'CondoHub Project Account',
      accountNumber: '209-0-00001-9',
      effectiveFrom: payeeEffectiveAt,
    },
    billingCtx,
  );
  const { default: seedQrSharp } = await import('sharp');
  const qrPng = await seedQrSharp({
    create: { width: 8, height: 8, channels: 3, background: '#2f2f2f' },
  })
    .png()
    .toBuffer();
  const mediaCtx = createMediaCtx({ requestId, isSeedActor: true });
  const payeeQr = await seedReadyImage(
    admin,
    {
      runId,
      fileName: 'payee-qr-210.png',
      scope: 'PAYMENT_QR',
      mime: 'image/png',
      bytes: qrPng,
      width: 8,
      height: 8,
    },
    mediaCtx,
  );
  await seedPayeeInstruction(
    admin,
    {
      payeeType: 'OWNER',
      payeeId: room210,
      bankName: 'E2E Test Bank',
      accountName: 'Amara Original Owner',
      accountNumber: '210-0-00001-9',
      qrImageId: payeeQr.imageId,
      effectiveFrom: payeeEffectiveAt,
    },
    billingCtx,
  );
  await seedPayeeInstruction(
    admin,
    {
      payeeType: 'OWNER',
      payeeId: room211,
      bankName: 'E2E Test Bank',
      accountName: 'Amara Original Owner',
      accountNumber: '211-0-00001-9',
      effectiveFrom: payeeEffectiveAt,
    },
    billingCtx,
  );
  await seedPayeeInstruction(
    admin,
    {
      payeeType: 'OWNER',
      payeeId: room212,
      bankName: 'E2E Test Bank',
      accountName: 'Amara Original Owner',
      accountNumber: '212-0-00001-9',
      effectiveFrom: payeeEffectiveAt,
    },
    billingCtx,
  );
  await seedPayeeInstruction(
    admin,
    {
      payeeType: 'PROJECT',
      payeeId: room213,
      bankName: 'E2E Test Bank',
      accountName: 'CondoHub Project Account',
      accountNumber: '213-0-00001-9',
      effectiveFrom: payeeEffectiveAt,
    },
    billingCtx,
  );
  await seedChargeEvent(
    admin,
    {
      eventEffectiveDate: '2026-06-15',
      configuredAmountSatang: 150000n,
      chargeContext: {
        note: `E2E-${runId} lobby renovation sinking fund. ${LONG_TEXT}`,
      },
      runId,
    },
    billingCtx,
  );
  console.log(`Billing seed complete for run ${runId}.`);
}

async function runMaintenanceScenario(
  runId: string,
  requestId: string,
  admin: Actor,
  structures: { buildingId: string; floorId: string },
  userIds: Map<string, string>,
): Promise<void> {
  const propertyCtx = createPropertyCtx({ requestId, isSeedActor: true });
  const ownerA = userIds.get('ownera') ?? '';
  const ownerB = userIds.get('ownernewb') ?? '';
  const rooms = new Map<string, string>();
  for (const code of ['301', '302', '303', '304', '305', '306']) {
    const room = await createRoom(
      admin,
      {
        floorId: structures.floorId,
        buildingId: structures.buildingId,
        roomCode: `E2E-${runId}-${code}`,
        areaSqm: '40.00',
        status: 'ACTIVE',
      },
      propertyCtx,
    );
    rooms.set(code, room.id);
  }
  const room301 = rooms.get('301') ?? '';
  const room302 = rooms.get('302') ?? '';
  const room303 = rooms.get('303') ?? '';
  const room304 = rooms.get('304') ?? '';
  const room305 = rooms.get('305') ?? '';
  const room306 = rooms.get('306') ?? '';
  await seedOwnership(
    admin,
    { roomId: room301, userId: ownerA, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await seedOwnership(
    admin,
    { roomId: room301, userId: ownerB, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room301,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await seedOwnership(
    admin,
    { roomId: room302, userId: ownerA, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room302,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await seedOwnership(
    admin,
    { roomId: room303, userId: ownerA, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room303,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await seedOwnership(
    admin,
    { roomId: room304, userId: ownerA, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await seedOwnership(
    admin,
    { roomId: room304, userId: ownerB, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room304,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await seedOwnership(
    admin,
    { roomId: room305, userId: ownerA, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room305,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await seedOwnership(
    admin,
    { roomId: room306, userId: ownerA, startAt: new Date('2023-01-01T00:00:00.000Z') },
    propertyCtx,
  );
  await createTenancy(
    admin,
    {
      roomId: room306,
      startsAt: new Date(),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  console.log(`Maintenance seed complete for run ${runId}.`);
}

interface ChatRoomSpec {
  code: string;
  ownerKey: string;
  secondOwnerKey: string | null;
  managementMode: 'PRIVATE_OWNER_MANAGED' | 'PROJECT_MANAGED';
}

const CHAT_ROOM_SPECS: ChatRoomSpec[] = [
  { code: '401', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '402', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '403', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '404', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '405', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '406', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '407', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '408', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '409', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '410', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '411', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '412', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '413', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '414', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '415', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
  { code: '416', ownerKey: 'ownera', secondOwnerKey: null, managementMode: 'PRIVATE_OWNER_MANAGED' },
];

async function runChatScenario(
  runId: string,
  requestId: string,
  admin: Actor,
  structures: { buildingId: string; floorId: string },
  userIds: Map<string, string>,
): Promise<void> {
  const propertyCtx = createPropertyCtx({ requestId, isSeedActor: true });
  const chatCtx = createChatCtx({ requestId, isSeedActor: true });
  const mediaCtx = createMediaCtx({ requestId, isSeedActor: true });
  const identityCtx = createIdentityCtx({ requestId, isSeedActor: true });
  const bootstrap = seedActor('seed-bootstrap', true);
  const safeRun = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const rooms = new Map<string, string>();
  for (const spec of CHAT_ROOM_SPECS) {
    const room = await createRoom(
      admin,
      {
        floorId: structures.floorId,
        buildingId: structures.buildingId,
        roomCode: `E2E-${runId}-${spec.code}`,
        areaSqm: '40.00',
        status: 'ACTIVE',
      },
      propertyCtx,
    );
    rooms.set(spec.code, room.id);
    await seedOwnership(
      admin,
      { roomId: room.id, userId: userIds.get(spec.ownerKey) ?? '', startAt: new Date('2023-01-01T00:00:00.000Z') },
      propertyCtx,
    );
    if (spec.secondOwnerKey !== null) {
      await seedOwnership(
        admin,
        { roomId: room.id, userId: userIds.get(spec.secondOwnerKey) ?? '', startAt: new Date('2023-01-01T00:00:00.000Z') },
        propertyCtx,
      );
    }
    if (spec.code === '402' || spec.code === '412') continue;
    await createTenancy(
      admin,
      {
        roomId: room.id,
        startsAt: new Date(),
        endsAt: null,
        managementMode: spec.managementMode,
        effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
      },
      propertyCtx,
    );
  }
  const chatUsers = new Map<string, string>();
  const chatAccounts = [
    { key: 'chattna', name: 'Araya Chattna' },
    { key: 'chattnb', name: 'Boriboon Chattnb' },
    { key: 'chatgap', name: 'Gaploy Chatgap' },
    { key: 'chatrev', name: 'Rerai Chatrev' },
    { key: 'chatexr', name: 'Exra Chatres' },
    { key: 'chatout', name: 'Outra Chatout' },
    { key: 'chatsnd', name: 'Sender Chatsnd' },
    { key: 'chatrcv', name: 'Receiver Chatrcv' },
    { key: 'chatobv', name: 'Observer Chatobv' },
  ] as const;
  for (const [index, account] of chatAccounts.entries()) {
    const username = `e2e${safeRun}${account.key}`.slice(0, 30);
    const result = await provisionSeedUser(
      bootstrap,
      {
        username,
        email: `${username}@example.invalid`,
        name: account.name,
        phone: `+6601000${String(2000 + index)}`,
        isSystemAdmin: false,
        initialFlags: { mustChangePassword: false, accountStatus: 'ACTIVE' },
      },
      identityCtx,
    );
    chatUsers.set(account.key, result.userId);
    console.log(`seed ${runId} ${account.key} tempPassword=${result.tempPassword}`);
  }
  const tenantA = chatUsers.get('chattna') ?? '';
  const tenantB = chatUsers.get('chattnb') ?? '';
  const gapActor = chatUsers.get('chatgap') ?? '';
  const rejoiner = chatUsers.get('chatrev') ?? '';
  const exResident = chatUsers.get('chatexr') ?? '';
  const sender = chatUsers.get('chatsnd') ?? '';
  const receiver = chatUsers.get('chatrcv') ?? '';
  const observer = chatUsers.get('chatobv') ?? '';
  const room402 = rooms.get('402') ?? '';
  const room403 = rooms.get('403') ?? '';
  const room405 = rooms.get('405') ?? '';
  const room407 = rooms.get('407') ?? '';
  const room408 = rooms.get('408') ?? '';
  const room409 = rooms.get('409') ?? '';
  const room411 = rooms.get('411') ?? '';
  const room412 = rooms.get('412') ?? '';
  const room413 = rooms.get('413') ?? '';
  const room414 = rooms.get('414') ?? '';
  const room415 = rooms.get('415') ?? '';
  const room416 = rooms.get('416') ?? '';
  const dayMs = 86_400_000;
  const seedNow = Date.now();
  const gapEarlyStart = new Date(seedNow - 40 * dayMs);
  const gapEarlyEnd = new Date(seedNow - 30 * dayMs);
  const gapDay = new Date(seedNow - 25 * dayMs);
  const gapLateStart = new Date(seedNow - 20 * dayMs);
  const adminActor = seedActor(admin.userId, true);
  const clockAt = (at: Date): ChatCtx => ({ ...chatCtx, clock: { now: () => at } });
  const blackoutTenancy = await createTenancy(
    admin,
    {
      roomId: room412,
      startsAt: new Date('2023-01-01T00:00:00.000Z'),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  await sendMessage(
    adminActor,
    { roomId: room412, clientMessageId: randomUUID(), text: `Tenancy window control for run ${runId}.` },
    clockAt(new Date(seedNow - 20 * dayMs)),
  );
  await endTenancyAt(
    admin,
    { tenancyId: blackoutTenancy.id, endsAt: new Date(seedNow - 10 * dayMs) },
    propertyCtx,
  );
  const gapTenancy = await createTenancy(
    admin,
    {
      roomId: room402,
      startsAt: new Date('2023-01-01T00:00:00.000Z'),
      endsAt: null,
      managementMode: 'PRIVATE_OWNER_MANAGED',
      effectiveAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    propertyCtx,
  );
  const gapFirst = await addMembership(
    admin,
    { roomId: room402, userId: gapActor, memberRole: 'SUB', tenancyId: gapTenancy.id, effectiveAt: gapEarlyStart },
    propertyCtx,
  );
  await endMembershipAt(
    admin,
    { roomId: room402, membershipId: gapFirst.id, endsAt: gapEarlyEnd },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room402, userId: gapActor, memberRole: 'SUB', tenancyId: gapTenancy.id, effectiveAt: gapLateStart },
    propertyCtx,
  );
  const tenancyByRoom = new Map<string, string>();
  for (const roomId of [room403, room405, room407, room408, room409, room411, room413, room414, room415, room416]) {
    const active = await listRoomActiveTenancies(roomId);
    const current = active[0];
    if (current === undefined) throw new Error('Chat seed room has no active tenancy.');
    tenancyByRoom.set(roomId, current.id);
  }
  const tenancyFor = (roomId: string): string => {
    const found = tenancyByRoom.get(roomId);
    if (found === undefined) throw new Error('Chat seed tenancy lookup failed.');
    return found;
  };
  await addMembership(
    admin,
    { roomId: room403, userId: tenantB, memberRole: 'MAIN', tenancyId: tenancyFor(room403) },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room405, userId: sender, memberRole: 'MAIN', tenancyId: tenancyFor(room405) },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room405, userId: receiver, memberRole: 'SUB', tenancyId: tenancyFor(room405) },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room407, userId: tenantA, memberRole: 'MAIN', tenancyId: tenancyFor(room407) },
    propertyCtx,
  );
  const revokeFirst = await addMembership(
    admin,
    { roomId: room408, userId: rejoiner, memberRole: 'MAIN', tenancyId: tenancyFor(room408) },
    propertyCtx,
  );
  await endMembershipAt(
    admin,
    { roomId: room408, membershipId: revokeFirst.id },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room409, userId: exResident, memberRole: 'MAIN', tenancyId: tenancyFor(room409) },
    propertyCtx,
  );
  const exMembership = await addMembership(
    admin,
    { roomId: room411, userId: exResident, memberRole: 'MAIN', tenancyId: tenancyFor(room411) },
    propertyCtx,
  );
  await endMembershipAt(
    admin,
    { roomId: room411, membershipId: exMembership.id },
    propertyCtx,
  );
  await addMembership(
    admin,
    {
      roomId: room413,
      userId: observer,
      memberRole: 'MAIN',
      tenancyId: tenancyFor(room413),
      effectiveAt: new Date(seedNow - 6 * dayMs),
    },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room414, userId: gapActor, memberRole: 'SUB', tenancyId: tenancyFor(room414) },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room415, userId: sender, memberRole: 'MAIN', tenancyId: tenancyFor(room415) },
    propertyCtx,
  );
  await addMembership(
    admin,
    { roomId: room416, userId: receiver, memberRole: 'SUB', tenancyId: tenancyFor(room416) },
    propertyCtx,
  );
  const senderActor = seedActor(sender, false);
  const observerActor = seedActor(observer, false);
  const gapActorSession = seedActor(gapActor, false);
  await sendMessage(
    gapActorSession,
    { roomId: room402, clientMessageId: randomUUID(), text: `Early segment note for run ${runId}.` },
    clockAt(new Date(seedNow - 35 * dayMs)),
  );
  await sendMessage(
    adminActor,
    { roomId: room402, clientMessageId: randomUUID(), text: `Gap-day control for run ${runId}.` },
    clockAt(gapDay),
  );
  await sendMessage(
    gapActorSession,
    { roomId: room402, clientMessageId: randomUUID(), text: `Late segment note for run ${runId}.` },
    clockAt(new Date(seedNow - 10 * dayMs)),
  );
  await sendMessage(
    senderActor,
    { roomId: room405, clientMessageId: randomUUID(), text: `Hello from sender for run ${runId}.` },
    chatCtx,
  );
  const validationClock = clockAt(new Date(seedNow - 5 * dayMs));
  for (let page = 0; page < 65; page += 1) {
    await sendMessage(
      observerActor,
      {
        roomId: room413,
        clientMessageId: randomUUID(),
        text: `History page message ${String(page + 1).padStart(2, '0')} for run ${runId}.`,
      },
      { ...validationClock, clock: { now: () => new Date(seedNow - 5 * dayMs + page * 1000) } },
    );
  }
  await sendMessage(
    adminActor,
    { roomId: room402, clientMessageId: randomUUID(), text: `Blackout window control for run ${runId}.` },
    clockAt(new Date(seedNow - 35 * dayMs)),
  );
  const { default: sharp } = await import('sharp');
  const tinyPng = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#4f7fbf' },
  })
    .png()
    .toBuffer();
  for (const [index, fileName] of ['chat-seed-attach.png', 'chat-seed-foreign-scope.png', 'chat-seed-extra.png'].entries()) {
    await seedReadyImage(
      admin,
      {
        runId,
        fileName: `chat${fileName}`,
        scope: index === 1 ? 'MAINTENANCE' : 'CHAT',
        mime: 'image/png',
        bytes: tinyPng,
        width: 8,
        height: 8,
      },
      mediaCtx,
    );
  }
  console.log(`Chat seed complete for run ${runId}.`);
}
