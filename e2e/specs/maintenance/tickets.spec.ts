import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsAdmin, loginAsUser, provisionUser, signInSuspendedActor } from '../../helpers/owner';
import { buildValidImage } from '../../helpers/announcementFiles';
import { completeUpload, mintIntent, putBytes, readAccess } from '../upload/uploadFlow';
import {
  findMaintenanceRoom,
  getEligibleRooms,
  getEligibleRoomsRaw,
  getTicket,
  getTicketRaw,
  listTickets,
  listTicketsRaw,
  patchTicket,
  postTicket,
  postTicketComment,
  type ErrorEnvelope,
  type TicketCommentEnvelope,
  type TicketCreateEnvelope,
  type TicketDetailEnvelope,
} from './maintenanceFlow';

interface ProbeTicketResult {
  ticketId: string;
  ticket: {
    routingKind: string;
    roomId: string | null;
    status: string;
    version: number;
    reporterId: string;
  } | null;
  recipients: Array<{ userId: string; ownershipIntervalRef: string | null }>;
  comments: Array<{ id: string; authorId: string }>;
  history: Array<{ fromState: string; toState: string; actorId: string | null }>;
}

interface ProbeRecipientsResult {
  ticketId: string;
  recipients: Array<{ userId: string; ownershipIntervalRef: string | null }>;
}

interface ProbeHistoryResult {
  ticketId: string;
  history: Array<{ fromState: string; toState: string; actorId: string | null; reason: string | null }>;
}

interface ProbeCountResult {
  roomCode: string;
  count: number;
}

async function runMaintenanceOps(args: string[]): Promise<string> {
  const root = path.resolve(__dirname, '..', '..', '..');
  return new Promise<string>((resolve, reject) => {
    const child = spawn('pnpm', ['maintenance:ops', ...args], {
      cwd: root,
      shell: process.platform === 'win32',
      env: process.env,
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number) => {
      if (code !== 0) {
        reject(new Error(`maintenance:ops ${args.join(' ')} exited ${code}: ${output} ${errors}`));
        return;
      }
      const line = output
        .split('\n')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith('{'));
      if (line === undefined) throw new Error(`maintenance:ops printed no result: ${output} ${errors}`);
      resolve(line);
    });
  });
}

async function probeTicket(ticketId: string): Promise<ProbeTicketResult> {
  return JSON.parse(await runMaintenanceOps(['probe-ticket', '--', '--ticket', ticketId])) as ProbeTicketResult;
}

async function probeRecipients(ticketId: string): Promise<ProbeRecipientsResult> {
  return JSON.parse(
    await runMaintenanceOps(['probe-recipients', '--', '--ticket', ticketId]),
  ) as ProbeRecipientsResult;
}

async function probeHistory(ticketId: string): Promise<ProbeHistoryResult> {
  return JSON.parse(await runMaintenanceOps(['probe-history', '--', '--ticket', ticketId])) as ProbeHistoryResult;
}

async function probeTicketCount(roomCode: string): Promise<number> {
  const line = await runMaintenanceOps(['probe-ticket-count', '--', '--room', roomCode]);
  return (JSON.parse(line) as ProbeCountResult).count;
}

async function mintReadyImage(
  request: APIRequestContext,
  fileName: string,
): Promise<string> {
  const fixture = await buildValidImage('png', 16);
  const intent = await mintIntent(request, {
    scope: 'MAINTENANCE',
    entityRef: { type: 'owner', id: null },
    contentType: fixture.contentType,
    fileName,
  });
  expect(intent.status).toBe(200);
  expect(await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes)).toBeLessThan(300);
  const completed = await completeUpload(request, intent.json.data.imageId);
  expect(completed.status).toBe(200);
  expect(completed.json.data.state).toBe('READY');
  return intent.json.data.imageId;
}

async function backdatedTransfer(
  page: Page,
  input: { roomId: string; fromUserId: string; toUserId: string; effectiveAt: string },
): Promise<void> {
  const transferred = await apiJson<{ data: { endedOwnershipId: string } }>(page.request, {
    method: 'POST',
    path: `/api/admin/rooms/${input.roomId}/ownerships`,
    body: {
      action: 'TRANSFER',
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      effectiveAt: input.effectiveAt,
    },
  });
  expect(transferred.status).toBe(200);
}

async function setAccountStatus(page: Page, userId: string, accountStatus: string): Promise<void> {
  const updated = await apiJson<{ data: { userId: string } }>(page.request, {
    method: 'PATCH',
    path: `/api/admin/users/${userId}/status`,
    body: { accountStatus },
  });
  expect(updated.status).toBe(200);
}

interface ActorSession {
  userId: string;
  username: string;
  password: string;
  page: Page;
  close: () => Promise<void>;
}

interface TicketsCtx {
  repA: ActorSession;
  repB: ActorSession;
  ownB: ActorSession;
  ownC: ActorSession;
  ownD: ActorSession;
  ownE: ActorSession;
  buyC: ActorSession;
  room301: string;
  room302: string;
  room303: string;
  tenancy303: string;
}

const ctx: Partial<TicketsCtx> = {};

function actorUsername(runId: string, workerIndex: number, stem: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `e2e${suffix}${stem}${workerIndex}`.slice(0, 30);
}

function actorPassword(runId: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `Mnt-${suffix}-pw1`;
}

function ticketBody(ns: string, stem: string): { locationDescription: string; subject: string; description: string } {
  return {
    locationDescription: `Lobby lift hall ${ns} ${stem}`,
    subject: `Flickering light ${ns} ${stem}`,
    description: `The lobby light flickers after midnight. Run ${ns} case ${stem}.`,
  };
}

test.describe('maintenance tickets: routing, privacy, lifecycle, concurrency', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision seven actors and wire 301/302/303 ownerships and tenancies', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room301 = await findMaintenanceRoom(page, `E2E-${runId}-301`);
    const room302 = await findMaintenanceRoom(page, `E2E-${runId}-302`);
    const room303 = await findMaintenanceRoom(page, `E2E-${runId}-303`);
    ctx.room301 = room301;
    ctx.room302 = room302;
    ctx.room303 = room303;
    const password = actorPassword(runId);

    async function provisionActor(stem: string): Promise<ActorSession> {
      const username = actorUsername(runId, testInfo.workerIndex, stem);
      const provisioned = await provisionUser(page, { username, name: `Tickets ${stem} ${runId}` });
      const context = await browser.newContext({ baseURL });
      const userPage = await context.newPage();
      await completeFirstLogin(userPage, {
        username,
        tempPassword: provisioned.tempPassword,
        newPassword: password,
      });
      return { userId: provisioned.userId, username, password, page: userPage, close: () => context.close() };
    }

    const repA = await provisionActor('mntrepa');
    const repB = await provisionActor('mntrepb');
    const ownB = await provisionActor('mntownb');
    const ownC = await provisionActor('mntownc');
    const ownD = await provisionActor('mntownd');
    const ownE = await provisionActor('mntowne');
    const buyC = await provisionActor('mntbuyc');
    ctx.repA = repA;
    ctx.repB = repB;
    ctx.ownB = ownB;
    ctx.ownC = ownC;
    ctx.ownD = ownD;
    ctx.ownE = ownE;
    ctx.buyC = buyC;

    const owners301 = await apiJson<{ data: { owners: Array<{ userId: string }> } }>(page.request, {
      method: 'GET',
      path: `/api/rooms/${room301}`,
    });
    expect(owners301.status).toBe(200);
    expect(owners301.json.data.owners).toHaveLength(2);
    await backdatedTransfer(page, {
      roomId: room301,
      fromUserId: owners301.json.data.owners[0]?.userId ?? '',
      toUserId: ownB.userId,
      effectiveAt: '2023-01-02T00:00:00.000Z',
    });
    await backdatedTransfer(page, {
      roomId: room301,
      fromUserId: owners301.json.data.owners[1]?.userId ?? '',
      toUserId: ownC.userId,
      effectiveAt: '2023-01-02T00:00:00.000Z',
    });
    const owners301After = await apiJson<{ data: { owners: Array<{ userId: string }> } }>(page.request, {
      method: 'GET',
      path: `/api/rooms/${room301}`,
    });
    expect(owners301After.json.data.owners.map((owner) => owner.userId).sort()).toEqual(
      [ownB.userId, ownC.userId].sort(),
    );

    const owners302 = await apiJson<{ data: { owners: Array<{ userId: string }> } }>(page.request, {
      method: 'GET',
      path: `/api/rooms/${room302}`,
    });
    expect(owners302.status).toBe(200);
    expect(owners302.json.data.owners).toHaveLength(1);
    await backdatedTransfer(page, {
      roomId: room302,
      fromUserId: owners302.json.data.owners[0]?.userId ?? '',
      toUserId: ownD.userId,
      effectiveAt: '2023-01-02T00:00:00.000Z',
    });
    const granted = await apiJson<{ data: { userId: string } }>(ownD.page.request, {
      method: 'POST',
      path: `/api/rooms/${room302}/co-owners`,
      body: { userId: ownE.userId },
    });
    expect(granted.status).toBe(200);
    expect(granted.json.data.userId).toBe(ownE.userId);

    const detail303 = await apiJson<{
      data: { tenancies: Array<{ id: string; state: string; managementMode: string }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room303}` });
    expect(detail303.status).toBe(200);
    const tenancy303 = detail303.json.data.tenancies.find(
      (entry) => entry.state === 'ACTIVE' && entry.managementMode === 'PROJECT_MANAGED',
    );
    if (tenancy303 === undefined) throw new Error('Room 303 has no active PM tenancy.');
    ctx.tenancy303 = tenancy303.id;
    const joinedPm = await apiJson<{ data: { userId: string } }>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room303}/members`,
      body: { userId: repA.userId, memberRole: 'SUB', tenancyId: tenancy303.id },
    });
    expect(joinedPm.status).toBe(200);

    const detail301 = await apiJson<{
      data: { tenancies: Array<{ id: string; state: string; managementMode: string }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room301}` });
    const tenancy301 = detail301.json.data.tenancies.find((entry) => entry.state === 'ACTIVE');
    if (tenancy301 === undefined) throw new Error('Room 301 has no active tenancy.');
    const joined301 = await apiJson<{ data: { userId: string } }>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room301}/members`,
      body: { userId: repA.userId, memberRole: 'SUB', tenancyId: tenancy301.id },
    });
    expect(joined301.status).toBe(200);

    const detail302 = await apiJson<{
      data: { tenancies: Array<{ id: string; state: string; managementMode: string }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room302}` });
    const tenancy302 = detail302.json.data.tenancies.find((entry) => entry.state === 'ACTIVE');
    if (tenancy302 === undefined) throw new Error('Room 302 has no active tenancy.');
    const joined302 = await apiJson<{ data: { userId: string } }>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room302}/members`,
      body: { userId: repA.userId, memberRole: 'SUB', tenancyId: tenancy302.id },
    });
    expect(joined302.status).toBe(200);
    const resident302 = await apiJson<{ data: { userId: string } }>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room302}/members`,
      body: { userId: repB.userId, memberRole: 'SUB', tenancyId: tenancy302.id },
    });
    expect(resident302.status).toBe(200);

    const eligiblePrivate = await getEligibleRooms(repA.page.request, 'PRIVATE_OWNER');
    expect(eligiblePrivate.sort()).toEqual([room301, room302].sort());
    const eligiblePm = await getEligibleRooms(repA.page.request, 'PROJECT_MANAGED_PRIVATE');
    expect(eligiblePm).toEqual([room303]);
    const eligibleCommon = await getEligibleRooms(repA.page.request, 'COMMON_AREA');
    expect(eligibleCommon).toEqual([]);
  });

  test('golden-5: reporter routes private to one room, common and pm route to admin, admin never sees private', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room301 = ctx.room301 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownB = ctx.ownB?.page ?? page;
    const ownD = ctx.ownD?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room301,
      ...ticketBody(runId, 'golden'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;
    expect((created.json as TicketCreateEnvelope).data.roomId).toBe(room301);

    const recipients = await probeRecipients(ticketId);
    expect(recipients.recipients.map((entry) => entry.userId).sort()).toEqual(
      [ctx.ownB?.userId ?? '', ctx.ownC?.userId ?? ''].sort(),
    );

    const readerB = await getTicket(ownB.request, ticketId);
    expect(readerB.roomId).toBe(room301);
    const outsiderD = await getTicketRaw(ownD.request, ticketId);
    expect(outsiderD.status).toBe(404);
    expect((outsiderD.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');
    const adminDenied = await getTicketRaw(page.request, ticketId);
    expect(adminDenied.status).toBe(404);
    expect((adminDenied.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const comment = await postTicketComment(ownB.request, ticketId, {
      body: `Handler acknowledges the lobby light report for run ${runId}.`,
    });
    expect(comment.status).toBe(200);

    const moved = await patchTicket(ownB.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 1 });
    expect(moved.status).toBe(200);
    expect((moved.json as TicketDetailEnvelope).data.version).toBe(2);

    const done = await patchTicket(ownB.request, ticketId, { status: 'COMPLETED', expectedVersion: 2 });
    expect(done.status).toBe(200);
    expect((done.json as TicketDetailEnvelope).data.status).toBe('COMPLETED');

    const terminal = await getTicket(ownB.request, ticketId);
    expect(terminal.status).toBe('COMPLETED');
    expect(terminal.comments).toHaveLength(1);
    expect(terminal.history.map((entry) => entry.toState)).toEqual(['IN_PROGRESS', 'COMPLETED']);

    const late = await postTicketComment(ownB.request, ticketId, { body: 'Late note after completion.' });
    expect(late.status).toBe(404);
    expect((late.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const common = await postTicket(repA.request, {
      routingKind: 'COMMON_AREA',
      ...ticketBody(runId, 'golden-common'),
    });
    expect(common.status).toBe(200);
    expect((common.json as TicketCreateEnvelope).data.roomId).toBeNull();
    const commonId = (common.json as TicketCreateEnvelope).data.id;
    const adminCommon = await getTicket(page.request, commonId);
    expect(adminCommon.roomId).toBeNull();

    const pm = await postTicket(repA.request, {
      routingKind: 'PROJECT_MANAGED_PRIVATE',
      roomId: ctx.room303 ?? '',
      ...ticketBody(runId, 'golden-pm'),
    });
    expect(pm.status).toBe(200);
    const pmId = (pm.json as TicketCreateEnvelope).data.id;
    const adminPm = await getTicket(page.request, pmId);
    expect(adminPm.roomId).toBe(ctx.room303 ?? '');

    const adminList = await listTickets(page.request, { pageSize: 100 });
    expect(adminList.rows.some((row) => row.id === ticketId)).toBe(false);
    expect(adminList.rows.some((row) => row.id === commonId)).toBe(true);
    expect(adminList.rows.some((row) => row.id === pmId)).toBe(true);
  });

  test('ms-mnt-03 and ms-mnt-05: common ticket stores null room and stays reporter plus admin only', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const repA = ctx.repA?.page ?? page;
    const repB = ctx.repB?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'COMMON_AREA',
      ...ticketBody(runId, 'mnt03'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;
    expect((created.json as TicketCreateEnvelope).data.roomId).toBeNull();

    const probed = await probeTicket(ticketId);
    expect(probed.ticket?.roomId).toBeNull();
    expect(probed.recipients).toHaveLength(0);

    const residentDenied = await getTicketRaw(repB.request, ticketId);
    expect(residentDenied.status).toBe(404);
    expect((residentDenied.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const residentList = await listTickets(repB.request, { pageSize: 100 });
    expect(residentList.rows.some((row) => row.id === ticketId)).toBe(false);

    const reporterList = await listTickets(repA.request, { pageSize: 100 });
    expect(reporterList.rows.some((row) => row.id === ticketId)).toBe(true);

    const adminDetail = await getTicket(page.request, ticketId);
    expect(adminDetail.id).toBe(ticketId);
  });

  test('ms-mnt-02: same-room resident without grant gets no list row and no detail', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room302 = ctx.room302 ?? '';
    const repA = ctx.repA?.page ?? page;
    const repB = ctx.repB?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room302,
      ...ticketBody(runId, 'mnt02'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;

    const denied = await getTicketRaw(repB.request, ticketId);
    expect(denied.status).toBe(404);
    expect((denied.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const deniedList = await listTickets(repB.request, { pageSize: 100 });
    expect(deniedList.rows.some((row) => row.id === ticketId)).toBe(false);

    const deniedComment = await postTicketComment(repB.request, ticketId, { body: 'Same-room guess.' });
    expect(deniedComment.status).toBe(404);
  });

  test('ms-mnt-04: dual-room reporter snapshots only the selected room owners', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room301 = ctx.room301 ?? '';
    const room302 = ctx.room302 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownB = ctx.ownB?.page ?? page;
    const ownD = ctx.ownD?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room301,
      ...ticketBody(runId, 'mnt04'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;
    expect((created.json as TicketCreateEnvelope).data.roomId).toBe(room301);

    const recipients = await probeRecipients(ticketId);
    expect(recipients.recipients).toHaveLength(2);
    expect(recipients.recipients.map((entry) => entry.userId).sort()).toEqual(
      [ctx.ownB?.userId ?? '', ctx.ownC?.userId ?? ''].sort(),
    );
    for (const entry of recipients.recipients) {
      expect(typeof entry.ownershipIntervalRef).toBe('string');
    }

    const selected = await getTicket(ownB.request, ticketId);
    expect(selected.roomId).toBe(room301);

    const otherRoom = await getTicketRaw(ownD.request, ticketId);
    expect(otherRoom.status).toBe(404);

    const byRoom = await listTickets(repA.request, { roomId: room301, pageSize: 100 });
    expect(byRoom.rows.some((row) => row.id === ticketId)).toBe(true);
    const byOtherRoom = await listTickets(ownB.request, { roomId: room302, pageSize: 100 });
    expect(byOtherRoom.rows.some((row) => row.id === ticketId)).toBe(false);

    const forged = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room301,
      recipientUserId: [ctx.ownD?.userId ?? ''],
      ...ticketBody(runId, 'mnt04forged'),
    });
    expect(forged.status).toBe(400);
    expect((forged.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');
  });

  test('ms-mnt-10 and ms-mnt-11: routing and room invariants reject with no partial ticket', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room301 = ctx.room301 ?? '';
    const room303 = ctx.room303 ?? '';
    const repA = ctx.repA?.page ?? page;
    const before301 = await probeTicketCount(`E2E-${runId}-301`);

    const commonWithRoom = await postTicket(repA.request, {
      routingKind: 'COMMON_AREA',
      roomId: room301,
      ...ticketBody(runId, 'mnt10a'),
    });
    expect(commonWithRoom.status).toBe(400);
    expect((commonWithRoom.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const privateWithoutRoom = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      ...ticketBody(runId, 'mnt10b'),
    });
    expect(privateWithoutRoom.status).toBe(400);

    const privateNoRoomKey = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: null,
      ...ticketBody(runId, 'mnt10c'),
    });
    expect(privateNoRoomKey.status).toBe(400);

    const ownerManagedAsPm = await postTicket(repA.request, {
      routingKind: 'PROJECT_MANAGED_PRIVATE',
      roomId: room301,
      ...ticketBody(runId, 'mnt11a'),
    });
    expect(ownerManagedAsPm.status).toBe(400);
    expect((ownerManagedAsPm.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const strangerRoom = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: randomUUID(),
      ...ticketBody(runId, 'mnt11b'),
    });
    expect(strangerRoom.status).toBe(400);

    const pmManagedAsPrivate = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room303,
      ...ticketBody(runId, 'mnt11c'),
    });
    expect(pmManagedAsPrivate.status).toBe(400);

    const after301 = await probeTicketCount(`E2E-${runId}-301`);
    expect(after301).toBe(before301);
  });

  test('ms-mnt-06 and ms-mnt-07: pm tenancy gates project-managed tickets with no fallback', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room303 = ctx.room303 ?? '';
    const repA = ctx.repA?.page ?? page;
    const repB = ctx.repB?.page ?? page;

    const routed = await postTicket(repA.request, {
      routingKind: 'PROJECT_MANAGED_PRIVATE',
      roomId: room303,
      ...ticketBody(runId, 'mnt06'),
    });
    expect(routed.status).toBe(200);
    const ticketId = (routed.json as TicketCreateEnvelope).data.id;
    const adminDetail = await getTicket(page.request, ticketId);
    expect(adminDetail.roomId).toBe(room303);
    expect(adminDetail.routingKind).toBe('PROJECT_MANAGED_PRIVATE');

    const noTenancy = await postTicket(repB.request, {
      routingKind: 'PROJECT_MANAGED_PRIVATE',
      roomId: room303,
      ...ticketBody(runId, 'mnt07'),
    });
    expect(noTenancy.status).toBe(400);
    expect((noTenancy.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const noCommonFallback = await listTickets(repB.request, { routingKind: 'COMMON_AREA', pageSize: 100 });
    expect(noCommonFallback.rows.some((row) => row.subject.includes('mnt07'))).toBe(false);
  });

  test('eligible-rooms and list filters: kind scoping, pagination, and admin concealment', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room301 = ctx.room301 ?? '';
    const room303 = ctx.room303 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownB = ctx.ownB?.page ?? page;

    const privateRooms = await getEligibleRooms(repA.request, 'PRIVATE_OWNER');
    expect(privateRooms.sort()).toEqual([room301, ctx.room302 ?? ''].sort());
    const pmRooms = await getEligibleRooms(repA.request, 'PROJECT_MANAGED_PRIVATE');
    expect(pmRooms).toEqual([room303]);
    const commonRooms = await getEligibleRooms(repA.request, 'COMMON_AREA');
    expect(commonRooms).toEqual([]);

    const missingKind = await getEligibleRoomsRaw(repA.request, '');
    expect(missingKind.status).toBe(400);
    const invalidKind = await getEligibleRoomsRaw(repA.request, '?routingKind=STREET');
    expect(invalidKind.status).toBe(400);

    const byKind = await listTickets(repA.request, { routingKind: 'PRIVATE_OWNER', pageSize: 100 });
    expect(byKind.rows.length).toBeGreaterThan(0);
    expect(byKind.rows.every((row) => row.routingKind === 'PRIVATE_OWNER')).toBe(true);

    const byStatus = await listTickets(repA.request, { status: 'PENDING', pageSize: 100 });
    expect(byStatus.rows.every((row) => row.status === 'PENDING')).toBe(true);

    const byRoom = await listTickets(repA.request, { roomId: room301, pageSize: 100 });
    expect(byRoom.rows.every((row) => row.roomId === room301)).toBe(true);

    const firstSheet = await listTickets(repA.request, { page: 1, pageSize: 1 });
    expect(firstSheet.rows).toHaveLength(1);
    expect(firstSheet.total).toBeGreaterThanOrEqual(1);
    expect(firstSheet.page).toBe(1);
    expect(firstSheet.pageSize).toBe(1);

    const adminPrivate = await listTicketsRaw(page.request, '?routingKind=PRIVATE_OWNER&pageSize=100');
    expect(adminPrivate.status).toBe(404);
    expect((adminPrivate.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const adminList = await listTickets(page.request, { pageSize: 100 });
    expect(adminList.rows.every((row) => row.routingKind !== 'PRIVATE_OWNER')).toBe(true);

    const recipientList = await listTickets(ownB.request, { pageSize: 100 });
    expect(recipientList.rows.some((row) => row.roomId === room301)).toBe(true);
    expect(recipientList.rows.every((row) => row.routingKind === 'PRIVATE_OWNER')).toBe(true);
    void runId;
  });

  test('ms-mnt-08: co-owners share one ticket id with append-only ordered comments', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room302 = ctx.room302 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownD = ctx.ownD?.page ?? page;
    const ownE = ctx.ownE?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room302,
      ...ticketBody(runId, 'mnt08'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;

    const first = await postTicketComment(ownD.request, ticketId, {
      body: `D starts the shared thread for run ${runId}.`,
    });
    expect(first.status).toBe(200);
    const second = await postTicketComment(ownE.request, ticketId, {
      body: `E continues the shared thread for run ${runId}.`,
    });
    expect(second.status).toBe(200);
    const third = await postTicketComment(repA.request, ticketId, {
      body: `Reporter adds detail for run ${runId}.`,
    });
    expect(third.status).toBe(200);

    const detailD = await getTicket(ownD.request, ticketId);
    const detailE = await getTicket(ownE.request, ticketId);
    expect(detailD.id).toBe(ticketId);
    expect(detailE.id).toBe(ticketId);
    expect(detailD.comments.map((entry) => entry.id)).toEqual([
      (first.json as TicketCommentEnvelope).data.id,
      (second.json as TicketCommentEnvelope).data.id,
      (third.json as TicketCommentEnvelope).data.id,
    ]);
    expect(detailE.comments.map((entry) => entry.body)).toEqual(
      detailD.comments.map((entry) => entry.body),
    );
    expect(detailD.version).toBe(detailE.version);

    const adminDenied = await getTicketRaw(page.request, ticketId);
    expect(adminDenied.status).toBe(404);

    const outsiderComment = await postTicketComment(ctx.ownB?.page.request ?? page.request, ticketId, {
      body: 'Outsider guess from another room.',
    });
    expect(outsiderComment.status).toBe(404);

    const adminComment = await postTicketComment(page.request, ticketId, {
      body: 'Admin guess on a private ticket.',
    });
    expect(adminComment.status).toBe(404);
  });

  test('ms-mnt-09: concurrent same-version transitions commit once and the loser gets 409', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room302 = ctx.room302 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownD = ctx.ownD?.page ?? page;
    const ownE = ctx.ownE?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room302,
      ...ticketBody(runId, 'mnt09'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;

    const raceD = patchTicket(ownD.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 1 });
    const raceE = patchTicket(ownE.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 1 });
    const [resultD, resultE] = await Promise.all([raceD, raceE]);
    const statuses = [resultD.status, resultE.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = resultD.status === 409 ? resultD : resultE;
    expect((loser.json as ErrorEnvelope).error.code).toBe('VERSION_CONFLICT');

    const probed = await probeTicket(ticketId);
    expect(probed.ticket?.version).toBe(2);
    expect(probed.ticket?.status).toBe('IN_PROGRESS');
    expect(probed.history).toHaveLength(1);

    const stale = await patchTicket(ownD.request, ticketId, { status: 'COMPLETED', expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect((stale.json as ErrorEnvelope).error.code).toBe('VERSION_CONFLICT');

    const fresh = await getTicket(ownD.request, ticketId);
    expect(fresh.version).toBe(2);
    const completed = await patchTicket(ownD.request, ticketId, { status: 'COMPLETED', expectedVersion: 2 });
    expect(completed.status).toBe(200);
  });

  test('ms-up-04 legs: five ticket images attach, sixth rejected; three comment images attach, fourth rejected', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room301 = ctx.room301 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownB = ctx.ownB?.page ?? page;

    const five: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      five.push(await mintReadyImage(repA.request, `mnt-cap-${index}.png`));
    }
    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room301,
      imageIds: five,
      ...ticketBody(runId, 'mntcap5'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;
    expect((created.json as TicketCreateEnvelope).data.images).toHaveLength(5);

    const sixth = await mintReadyImage(repA.request, 'mnt-cap-5.png');
    const before = await probeTicketCount(`E2E-${runId}-301`);
    const over = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room301,
      imageIds: [...five, sixth],
      ...ticketBody(runId, 'mntcap6'),
    });
    expect(over.status).toBe(400);
    expect((over.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');
    const after = await probeTicketCount(`E2E-${runId}-301`);
    expect(after).toBe(before);

    const trio: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      trio.push(await mintReadyImage(ownB.request, `mnt-ccap-${index}.png`));
    }
    const withImages = await postTicketComment(ownB.request, ticketId, {
      body: `Three photos attached for run ${runId}.`,
      imageIds: trio,
    });
    expect(withImages.status).toBe(200);
    expect((withImages.json as TicketCommentEnvelope).data.images).toHaveLength(3);

    const fourth = await mintReadyImage(ownB.request, 'mnt-ccap-3.png');
    const commentsBefore = (await probeTicket(ticketId)).comments.length;
    const overComment = await postTicketComment(ownB.request, ticketId, {
      body: 'Fourth photo must not attach.',
      imageIds: [...trio, fourth],
    });
    expect(overComment.status).toBe(400);
    const commentsAfter = (await probeTicket(ticketId)).comments.length;
    expect(commentsAfter).toBe(commentsBefore);
  });

  test('idempotency: same-key create and comment replay, mixed bodies rejected', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const repA = ctx.repA?.page ?? page;

    const createKey = randomUUID();
    const payload = {
      routingKind: 'COMMON_AREA',
      ...ticketBody(runId, 'mntidem'),
    };
    const first = await postTicket(repA.request, payload, createKey);
    expect(first.status).toBe(200);
    const firstId = (first.json as TicketCreateEnvelope).data.id;
    const replay = await postTicket(repA.request, payload, createKey);
    expect(replay.status).toBe(200);
    expect((replay.json as TicketCreateEnvelope).data.id).toBe(firstId);

    const mixed = await postTicket(
      repA.request,
      { ...payload, subject: `Different subject ${runId}` },
      createKey,
    );
    expect(mixed.status).toBe(400);
    expect((mixed.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const commentKey = randomUUID();
    const commentPayload = { body: `Idempotent comment for run ${runId}.` };
    const commentFirst = await postTicketComment(repA.request, firstId, commentPayload, commentKey);
    expect(commentFirst.status).toBe(200);
    const commentId = (commentFirst.json as TicketCommentEnvelope).data.id;
    const commentReplay = await postTicketComment(repA.request, firstId, commentPayload, commentKey);
    expect(commentReplay.status).toBe(200);
    expect((commentReplay.json as TicketCommentEnvelope).data.id).toBe(commentId);

    const commentMixed = await postTicketComment(
      repA.request,
      firstId,
      { body: 'Different body on the same key.' },
      commentKey,
    );
    expect(commentMixed.status).toBe(400);

    const invalidKey = await postTicket(repA.request, payload, 'not-a-uuid');
    expect(invalidKey.status).toBe(400);
  });


  test('ms-mnt-12: ownership transfer keeps assignees working and conceals from the buyer', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room301 = ctx.room301 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownB = ctx.ownB?.page ?? page;
    const ownC = ctx.ownC?.page ?? page;
    const buyC = ctx.buyC?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room301,
      ...ticketBody(runId, 'mnt12'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;

    const started = await patchTicket(ownB.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 1 });
    expect(started.status).toBe(200);

    await backdatedTransfer(page, {
      roomId: room301,
      fromUserId: ctx.ownB?.userId ?? '',
      toUserId: ctx.buyC?.userId ?? '',
      effectiveAt: new Date().toISOString(),
    });
    const ownersNow = await apiJson<{ data: { owners: Array<{ userId: string; ownershipId: string }> } }>(
      page.request,
      { method: 'GET', path: `/api/rooms/${room301}` },
    );
    expect(ownersNow.status).toBe(200);
    const coOwner = ownersNow.json.data.owners.find((entry) => entry.userId === (ctx.ownC?.userId ?? ''));
    if (coOwner === undefined) throw new Error('Co-owner C holds no interval to remove.');
    const removed = await apiJson<{ data: { ownershipId: string } }>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${room301}/ownerships`,
      body: {
        action: 'REMOVE',
        ownershipId: coOwner.ownershipId,
        effectiveAt: new Date().toISOString(),
      },
    });
    expect(removed.status).toBe(200);

    const stillWorks = await postTicketComment(ownB.request, ticketId, {
      body: `Former owner B keeps working after transfer for run ${runId}.`,
    });
    expect(stillWorks.status).toBe(200);
    const coWorks = await postTicketComment(ownC.request, ticketId, {
      body: `Former owner C keeps working after transfer for run ${runId}.`,
    });
    expect(coWorks.status).toBe(200);

    const buyerOpenGuess = await postTicketComment(buyC.request, ticketId, { body: 'Buyer guess.' });
    expect(buyerOpenGuess.status).toBe(404);

    const closed = await patchTicket(ownB.request, ticketId, { status: 'COMPLETED', expectedVersion: 2 });
    expect(closed.status).toBe(200);

    const buyerDenied = await getTicketRaw(buyC.request, ticketId);
    expect(buyerDenied.status).toBe(404);
    expect((buyerDenied.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const buyerList = await listTickets(buyC.request, { pageSize: 100 });
    expect(buyerList.rows.some((row) => row.id === ticketId)).toBe(false);

    const buyerTerminalGuess = await postTicketComment(buyC.request, ticketId, { body: 'Buyer late guess.' });
    expect(buyerTerminalGuess.status).toBe(404);

    const adminDenied = await getTicketRaw(page.request, ticketId);
    expect(adminDenied.status).toBe(404);

    const snapshot = await probeRecipients(ticketId);
    expect(snapshot.recipients.map((entry) => entry.userId).sort()).toEqual(
      [ctx.ownB?.userId ?? '', ctx.ownC?.userId ?? ''].sort(),
    );
  });

  test('ms-mnt-13: terminal tickets stay readable to assignees but deny every mutation', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room302 = ctx.room302 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownD = ctx.ownD?.page ?? page;
    const ownE = ctx.ownE?.page ?? page;
    const buyC = ctx.buyC?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room302,
      ...ticketBody(runId, 'mnt13'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;

    const imageId = await mintReadyImage(ownD.request, 'mnt13-photo.png');
    const comment = await postTicketComment(ownD.request, ticketId, {
      body: `Photo before terminal for run ${runId}.`,
      imageIds: [imageId],
    });
    expect(comment.status).toBe(200);

    const closed = await patchTicket(ownD.request, ticketId, { status: 'COMPLETED', expectedVersion: 1 });
    expect(closed.status).toBe(200);

    const reread = await getTicket(ownD.request, ticketId);
    expect(reread.status).toBe('COMPLETED');
    expect(reread.comments).toHaveLength(1);
    const rereadE = await getTicket(ownE.request, ticketId);
    expect(rereadE.history.map((entry) => entry.toState)).toEqual(['COMPLETED']);

    const imageAccess = await readAccess(ownD.request, imageId);
    expect(imageAccess.status).toBe(200);

    const lateComment = await postTicketComment(ownD.request, ticketId, { body: 'Late comment.' });
    expect(lateComment.status).toBe(404);
    expect((lateComment.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const latePatch = await patchTicket(ownD.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 2 });
    expect(latePatch.status).toBe(404);
    const reopen = await patchTicket(ownE.request, ticketId, { status: 'PENDING', expectedVersion: 2 });
    expect(reopen.status).toBe(404);

    const buyerDetail = await getTicketRaw(buyC.request, ticketId);
    expect(buyerDetail.status).toBe(404);
    const buyerImage = await readAccess(buyC.request, imageId);
    expect(buyerImage.status).toBe(403);
    const adminDetail = await getTicketRaw(page.request, ticketId);
    expect(adminDetail.status).toBe(404);
    const adminImage = await readAccess(page.request, imageId);
    expect(adminImage.status).toBe(403);

    const malformed = await getTicketRaw(ownD.request, 'not-a-uuid');
    expect(malformed.status).toBe(400);
    const unknown = await getTicketRaw(ownD.request, randomUUID());
    expect(unknown.status).toBe(404);
  });

  test('ms-mnt-01: admin private-ticket and image guessing denies with no metadata leak', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room302 = ctx.room302 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownD = ctx.ownD?.page ?? page;

    const imageId = await mintReadyImage(repA.request, 'mnt01-photo.png');
    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room302,
      imageIds: [imageId],
      ...ticketBody(runId, 'mnt01'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;

    const adminDetail = await getTicketRaw(page.request, ticketId);
    expect(adminDetail.status).toBe(404);
    expect((adminDetail.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');
    expect(JSON.stringify(adminDetail.json)).not.toContain('mnt01');

    const adminPatch = await patchTicket(page.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 1 });
    expect(adminPatch.status).toBe(404);

    const adminComment = await postTicketComment(page.request, ticketId, { body: 'Admin guess.' });
    expect(adminComment.status).toBe(404);

    const adminImage = await readAccess(page.request, imageId);
    expect(adminImage.status).toBe(403);

    const adminList = await listTickets(page.request, { roomId: room302, pageSize: 100 });
    expect(adminList.rows.some((row) => row.id === ticketId)).toBe(false);
    expect(adminList.total).toBe(adminList.rows.length);

    const recipientImage = await readAccess(ownD.request, imageId);
    expect(recipientImage.status).toBe(200);

    const unknownAdmin = await getTicketRaw(page.request, randomUUID());
    expect(unknownAdmin.status).toBe(404);
  });

  test('reject requires reason, reporter cancel is limited, same-status and bad transitions reject', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room302 = ctx.room302 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownD = ctx.ownD?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room302,
      ...ticketBody(runId, 'mntneg'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;

    const noReason = await patchTicket(ownD.request, ticketId, { status: 'REJECTED', expectedVersion: 1 });
    expect(noReason.status).toBe(400);
    expect((noReason.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const sameStatus = await patchTicket(ownD.request, ticketId, { status: 'PENDING', expectedVersion: 1 });
    expect(sameStatus.status).toBe(400);

    const reporterHandlerMove = await patchTicket(repA.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 1 });
    expect(reporterHandlerMove.status).toBe(404);
    expect((reporterHandlerMove.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const waiting = await patchTicket(ownD.request, ticketId, { status: 'WAITING_FOR_INFO', expectedVersion: 1 });
    expect(waiting.status).toBe(200);
    const reporterCancel = await patchTicket(repA.request, ticketId, { status: 'CANCELLED', expectedVersion: 2 });
    expect(reporterCancel.status).toBe(200);
    expect((reporterCancel.json as TicketDetailEnvelope).data.status).toBe('CANCELLED');

    const history = await probeHistory(ticketId);
    expect(history.history.map((entry) => entry.toState)).toEqual(['WAITING_FOR_INFO', 'CANCELLED']);
  });

  test('ms-mnt-14 and ms-mnt-15: moved-out reporter keeps own-ticket rights then reads terminal only', async ({
    page,
    browser,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    void browser;
    const room302 = ctx.room302 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownD = ctx.ownD?.page ?? page;

    const open = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room302,
      ...ticketBody(runId, 'mnt14open'),
    });
    expect(open.status).toBe(200);
    const openId = (open.json as TicketCreateEnvelope).data.id;
    const started = await patchTicket(ownD.request, openId, { status: 'IN_PROGRESS', expectedVersion: 1 });
    expect(started.status).toBe(200);

    const waiting = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room302,
      ...ticketBody(runId, 'mnt15wait'),
    });
    expect(waiting.status).toBe(200);
    const waitingId = (waiting.json as TicketCreateEnvelope).data.id;
    const parked = await patchTicket(ownD.request, waitingId, { status: 'WAITING_FOR_INFO', expectedVersion: 1 });
    expect(parked.status).toBe(200);

    const detail = await apiJson<{
      data: { memberships: Array<{ id: string; userId: string; endAt: string | null }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room302}` });
    expect(detail.status).toBe(200);
    const membership = detail.json.data.memberships.find(
      (entry) => entry.userId === (ctx.repA?.userId ?? '') && entry.endAt === null,
    );
    if (membership === undefined) throw new Error('Reporter A has no open membership in 302.');
    const ended = await apiJson<{ data: { endAt: string | null } }>(page.request, {
      method: 'PATCH',
      path: `/api/rooms/${room302}/members/${membership.id}`,
      body: { action: 'END' },
    });
    expect(ended.status).toBe(200);
    expect(ended.json.data.endAt).not.toBeNull();

    const stillReads = await getTicket(repA.request, openId);
    expect(stillReads.status).toBe('IN_PROGRESS');
    const stillComments = await postTicketComment(repA.request, openId, {
      body: `Moved-out reporter still comments for run ${runId}.`,
    });
    expect(stillComments.status).toBe(200);
    const noCancelOpen = await patchTicket(repA.request, openId, { status: 'CANCELLED', expectedVersion: 2 });
    expect(noCancelOpen.status).toBe(404);

    const cancelWaiting = await patchTicket(repA.request, waitingId, { status: 'CANCELLED', expectedVersion: 2 });
    expect(cancelWaiting.status).toBe(200);

    const terminal = await patchTicket(ownD.request, openId, { status: 'COMPLETED', expectedVersion: 2 });
    expect(terminal.status).toBe(200);
    const terminalRead = await getTicket(repA.request, openId);
    expect(terminalRead.status).toBe('COMPLETED');
    const terminalComment = await postTicketComment(repA.request, openId, { body: 'Late reporter note.' });
    expect(terminalComment.status).toBe(404);

    const otherTicket = await getTicketRaw(repA.request, (await getTicket(ownD.request, waitingId)).id);
    expect(otherTicket.status).toBe(200);
  });

  test('ms-mnt-16: suspending all recipients blocks everyone, reactivation restores the snapshot grant', async ({
    page,
    browser,
  }) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room302 = ctx.room302 ?? '';
    const repA = ctx.repA?.page ?? page;
    const ownD = ctx.ownD?.page ?? page;
    const ownE = ctx.ownE?.page ?? page;

    const roomDetail = await apiJson<{
      data: { tenancies: Array<{ id: string; state: string }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room302}` });
    expect(roomDetail.status).toBe(200);
    const tenancy = roomDetail.json.data.tenancies.find((entry) => entry.state === 'ACTIVE');
    if (tenancy === undefined) throw new Error('Room 302 has no active tenancy.');
    const rejoined = await apiJson<{ data: { userId: string } }>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room302}/members`,
      body: { userId: ctx.repA?.userId ?? '', memberRole: 'SUB', tenancyId: tenancy.id },
    });
    expect(rejoined.status).toBe(200);

    const created = await postTicket(repA.request, {
      routingKind: 'PRIVATE_OWNER',
      roomId: room302,
      ...ticketBody(runId, 'mnt16'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;

    await setAccountStatus(page, ctx.ownD?.userId ?? '', 'SUSPENDED');
    await setAccountStatus(page, ctx.ownE?.userId ?? '', 'SUSPENDED');

    const suspendedDContext = await browser.newContext({ baseURL });
    const suspendedD = await suspendedDContext.newPage();
    const suspendedEContext = await browser.newContext({ baseURL });
    const suspendedE = await suspendedEContext.newPage();
    try {
      const signinD = await signInSuspendedActor(suspendedD.request, {
        username: ctx.ownD?.username ?? '',
        password: ctx.ownD?.password ?? '',
      });
      expect(signinD.status).toBe(200);
      const signinE = await signInSuspendedActor(suspendedE.request, {
        username: ctx.ownE?.username ?? '',
        password: ctx.ownE?.password ?? '',
      });
      expect(signinE.status).toBe(200);

      const deniedD = await getTicketRaw(suspendedD.request, ticketId);
      expect(deniedD.status).toBe(403);
      expect((deniedD.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');
      const deniedE = await getTicketRaw(suspendedE.request, ticketId);
      expect(deniedE.status).toBe(403);

      const deniedComment = await postTicketComment(suspendedD.request, ticketId, { body: 'Suspended note.' });
      expect(deniedComment.status).toBe(403);

      const deniedMove = await patchTicket(suspendedD.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 1 });
      expect(deniedMove.status).toBe(403);

      const reporterStillWorks = await postTicketComment(repA.request, ticketId, {
        body: `Reporter works while recipients are suspended for run ${runId}.`,
      });
      expect(reporterStillWorks.status).toBe(200);

      const stillPending = await probeTicket(ticketId);
      expect(stillPending.ticket?.status).toBe('PENDING');
      expect(stillPending.recipients).toHaveLength(2);
    } finally {
      await suspendedDContext.close();
      await suspendedEContext.close();
    }

    await setAccountStatus(page, ctx.ownD?.userId ?? '', 'ACTIVE');
    await loginAsUser(ownD, ctx.ownD?.username ?? '', ctx.ownD?.password ?? '');

    const restored = await getTicket(ownD.request, ticketId);
    expect(restored.status).toBe('PENDING');
    const restoredMove = await patchTicket(ownD.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 1 });
    expect(restoredMove.status).toBe(200);

    await setAccountStatus(page, ctx.ownE?.userId ?? '', 'ACTIVE');
    await loginAsUser(ownE, ctx.ownE?.username ?? '', ctx.ownE?.password ?? '');
    const coRestored = await getTicket(ownE.request, ticketId);
    expect(coRestored.status).toBe('IN_PROGRESS');
  });

  test('common terminal: reporter cancel closes, admin reads on, mutations deny', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room303 = ctx.room303 ?? '';
    const repA = ctx.repA?.page ?? page;

    const created = await postTicket(repA.request, {
      routingKind: 'PROJECT_MANAGED_PRIVATE',
      roomId: room303,
      ...ticketBody(runId, 'mntpmterm'),
    });
    expect(created.status).toBe(200);
    const ticketId = (created.json as TicketCreateEnvelope).data.id;

    const cancel = await patchTicket(repA.request, ticketId, { status: 'CANCELLED', expectedVersion: 1 });
    expect(cancel.status).toBe(200);

    const adminReads = await getTicket(page.request, ticketId);
    expect(adminReads.status).toBe('CANCELLED');

    const adminMove = await patchTicket(page.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 2 });
    expect(adminMove.status).toBe(403);
    expect((adminMove.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');

    const reporterMove = await patchTicket(repA.request, ticketId, { status: 'IN_PROGRESS', expectedVersion: 2 });
    expect(reporterMove.status).toBe(403);

    const outsiderMove = await patchTicket(ctx.repB?.page.request ?? page.request, ticketId, {
      status: 'IN_PROGRESS',
      expectedVersion: 2,
    });
    expect(outsiderMove.status).toBe(403);
  });

  test.afterAll(async () => {
    for (const session of [ctx.repA, ctx.repB, ctx.ownB, ctx.ownC, ctx.ownD, ctx.ownE, ctx.buyC]) {
      await session?.close();
    }
  });
});
