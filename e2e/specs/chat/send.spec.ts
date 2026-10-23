import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsPoolAdmin, provisionUser, submitFirstLoginStep } from '../../helpers/owner';
import { buildValidImage } from '../../helpers/announcementFiles';
import { completeUpload, mintIntent, putBytes, readAccess } from '../upload/uploadFlow';
import {
  asChatError,
  asChatSend,
  findChatRoom,
  listMessages,
  postMessage,
} from './chatFlow';

interface ActorSession {
  userId: string;
  username: string;
  password: string;
  page: Page;
  close: () => Promise<void>;
}

interface SendCtx {
  room401: string;
  room406: string;
  tenantA: ActorSession;
  tenantB: ActorSession;
  outsider: ActorSession;
  suspended: ActorSession;
  firstLogin: { username: string; tempPassword: string; page: Page; close: () => Promise<void> };
  ownerUserId: string;
  tenancy401: string;
  turnoverMessageId: string;
  replayKey: string;
  replayMessageId: string;
}

const ctx: Partial<SendCtx> = {};

function actorUsername(runId: string, workerIndex: number, stem: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `e2e${suffix}${stem}${workerIndex}`.slice(0, 30);
}

function actorPassword(runId: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `Cht-${suffix}-pw1`;
}

async function provisionActor(
  adminPage: Page,
  browser: Browser,
  baseURL: string,
  runId: string,
  workerIndex: number,
  stem: string,
): Promise<ActorSession> {
  const username = actorUsername(runId, workerIndex, stem);
  const provisioned = await provisionUser(adminPage, { username, name: `Chat ${stem} ${runId}` });
  const password = actorPassword(runId);
  const context = await browser.newContext({ baseURL });
  const userPage = await context.newPage();
  await completeFirstLogin(userPage, {
    username,
    tempPassword: provisioned.tempPassword,
    newPassword: password,
  });
  return { userId: provisioned.userId, username, password, page: userPage, close: () => context.close() };
}

async function runChatOps(args: string[]): Promise<string> {
  const root = path.resolve(__dirname, '..', '..', '..');
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const child = spawn('pnpm', ['chat:ops', ...args], {
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
            reject(new Error(`chat:ops ${args.join(' ')} exited ${code}: ${output} ${errors}`));
            return;
          }
          const line = output
            .split('\n')
            .map((entry) => entry.trim())
            .find((entry) => entry.startsWith('{'));
          if (line === undefined) throw new Error(`chat:ops printed no result: ${output} ${errors}`);
          resolve(line);
        });
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('chat:ops failed four times.');
}

async function probeMessageCount(roomCode: string): Promise<number> {
  const line = await runChatOps(['probe-message-count', '--', '--room', roomCode]);
  return (JSON.parse(line) as { count: number }).count;
}

async function mintReadyChatImage(requestPage: Page, fileName: string): Promise<string> {
  const fixture = await buildValidImage('png', 16);
  const intent = await mintIntent(requestPage.request, {
    scope: 'CHAT',
    entityRef: { type: 'chat_message', id: null },
    contentType: fixture.contentType,
    fileName,
  });
  expect(intent.status).toBe(200);
  expect(await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes)).toBeLessThan(300);
  const completed = await completeUpload(requestPage.request, intent.json.data.imageId);
  expect(completed.status).toBe(200);
  expect(completed.json.data.state).toBe('READY');
  return intent.json.data.imageId;
}

test.describe('chat send: content, snapshot, replay, denies, rate limit', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision actors and join tenant A to 401', async ({ page, browser }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatsend');
    const room401 = await findChatRoom(page, `E2E-${runId}-401`);
    const room406 = await findChatRoom(page, `E2E-${runId}-406`);
    ctx.room401 = room401;
    ctx.room406 = room406;
    const tenantA = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtatda');
    const tenantB = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtatdb');
    const outsider = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtoutx');
    const suspended = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtsusp');
    ctx.tenantA = tenantA;
    ctx.tenantB = tenantB;
    ctx.outsider = outsider;
    ctx.suspended = suspended;
    const freshUsername = actorUsername(runId, testInfo.workerIndex, 'chtfrsh');
    const freshProvisioned = await provisionUser(page, {
      username: freshUsername,
      name: `Chat fresh ${runId}`,
    });
    const freshContext = await browser.newContext({ baseURL });
    const freshPage = await freshContext.newPage();
    await submitFirstLoginStep(freshPage, {
      username: freshUsername,
      tempPassword: freshProvisioned.tempPassword,
    });
    ctx.firstLogin = {
      username: freshUsername,
      tempPassword: freshProvisioned.tempPassword,
      page: freshPage,
      close: () => freshContext.close(),
    };
    const detail = await apiJson<{
      data: {
        owners: Array<{ userId: string }>;
        tenancies: Array<{ id: string; state: string }>;
        memberships: Array<{ id: string; userId: string; endAt: string | null }>;
      };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room401}` });
    expect(detail.status).toBe(200);
    ctx.ownerUserId = detail.json.data.owners[0]?.userId ?? '';
    const tenancy = detail.json.data.tenancies.find((entry) => entry.state === 'ACTIVE');
    if (tenancy === undefined) throw new Error('Room 401 has no active tenancy.');
    ctx.tenancy401 = tenancy.id;
    for (const joinUser of [tenantA.userId, suspended.userId]) {
      const joined = await apiJson<{ data: { userId: string } }>(page.request, {
        method: 'POST',
        path: `/api/rooms/${room401}/members`,
        body: { userId: joinUser, memberRole: 'MAIN', tenancyId: tenancy.id },
      });
      expect(joined.status).toBe(200);
    }
    const suspend = await apiJson<{ data: { userId: string } }>(page.request, {
      method: 'PATCH',
      path: `/api/admin/users/${suspended.userId}/status`,
      body: { accountStatus: 'SUSPENDED' },
    });
    expect(suspend.status).toBe(200);
  });

  test('golden-6 send leg: tenant A text send 200 with sender snapshot', async () => {
    const room401 = ctx.room401 ?? '';
    const tenantA = ctx.tenantA?.page;
    if (tenantA === undefined) throw new Error('Tenant A session is missing.');
    const sent = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      text: 'Hello from tenant A before turnover.',
    });
    expect(sent.status).toBe(200);
    const dto = asChatSend(sent.json).data;
    expect(dto.type).toBe('TEXT');
    expect(dto.text).toBe('Hello from tenant A before turnover.');
    expect(dto.senderUserId).toBe(ctx.tenantA?.userId ?? '');
    expect(dto.senderName).toBe(`Chat chtatda ${await readRunContext().then((entry) => entry.runId)}`);
    expect(dto.senderIsAdmin).toBe(false);
    ctx.turnoverMessageId = dto.id;
    expect(await probeMessageCount(`E2E-${(await readRunContext()).runId}-401`)).toBe(1);
  });

  test('text plus image 200 and image-only 200 with READY CHAT image', async () => {
    const { runId } = await readRunContext();
    const room401 = ctx.room401 ?? '';
    const tenantA = ctx.tenantA?.page;
    if (tenantA === undefined) throw new Error('Tenant A session is missing.');
    const firstImage = await mintReadyChatImage(tenantA, `e2e-${runId}-chat-a.png`);
    const withImage = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      text: 'Lobby photo from tenant A.',
      imageId: firstImage,
    });
    expect(withImage.status).toBe(200);
    const withImageDto = asChatSend(withImage.json).data;
    expect(withImageDto.type).toBe('IMAGE');
    expect(withImageDto.imageId).toBe(firstImage);
    expect(withImageDto.text).toBe('Lobby photo from tenant A.');
    const secondImage = await mintReadyChatImage(tenantA, `e2e-${runId}-chat-b.png`);
    const imageOnly = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      imageId: secondImage,
    });
    expect(imageOnly.status).toBe(200);
    expect(asChatSend(imageOnly.json).data.type).toBe('IMAGE');
  });

  test('empty body 400 and over-20000 text 400 with no message created', async () => {
    const { runId } = await readRunContext();
    const room401 = ctx.room401 ?? '';
    const tenantA = ctx.tenantA?.page;
    if (tenantA === undefined) throw new Error('Tenant A session is missing.');
    const before = await probeMessageCount(`E2E-${runId}-401`);
    const empty = await postMessage(tenantA.request, room401, { clientMessageId: randomUUID() });
    expect(empty.status).toBe(400);
    expect(asChatError(empty.json).error.code).toBe('VALIDATION_ERROR');
    const blank = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      text: '   ',
    });
    expect(blank.status).toBe(400);
    const oversized = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      text: 'x'.repeat(20001),
    });
    expect(oversized.status).toBe(400);
    expect(asChatError(oversized.json).error.code).toBe('VALIDATION_ERROR');
    const capped = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      text: 'y'.repeat(20000),
    });
    expect(capped.status).toBe(200);
    expect(await probeMessageCount(`E2E-${runId}-401`)).toBe(before + 1);
  });

  test('ms-up-04 chat legs: second pending intent 400, reused image 400, no half record', async () => {
    const { runId } = await readRunContext();
    const room401 = ctx.room401 ?? '';
    const tenantA = ctx.tenantA?.page;
    if (tenantA === undefined) throw new Error('Tenant A session is missing.');
    const before = await probeMessageCount(`E2E-${runId}-401`);
    const firstFixture = await buildValidImage('png', 16);
    const firstIntent = await mintIntent(tenantA.request, {
      scope: 'CHAT',
      entityRef: { type: 'chat_message', id: null },
      contentType: firstFixture.contentType,
      fileName: `e2e-${runId}-chat-cap-a.png`,
    });
    expect(firstIntent.status).toBe(200);
    const secondIntent = await mintIntent(tenantA.request, {
      scope: 'CHAT',
      entityRef: { type: 'chat_message', id: null },
      contentType: firstFixture.contentType,
      fileName: `e2e-${runId}-chat-cap-b.png`,
    });
    expect(secondIntent.status).toBe(400);
    expect(await putBytes(firstIntent.json.data.uploadUrl, firstFixture.contentType, firstFixture.bytes)).toBeLessThan(300);
    const completed = await completeUpload(tenantA.request, firstIntent.json.data.imageId);
    expect(completed.status).toBe(200);
    const attached = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      imageId: firstIntent.json.data.imageId,
    });
    expect(attached.status).toBe(200);
    const reused = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      imageId: firstIntent.json.data.imageId,
    });
    expect(reused.status).toBe(400);
    expect(await probeMessageCount(`E2E-${runId}-401`)).toBe(before + 1);
  });

  test('non-READY, other-scope, and other-owner image ids 400 with no message created', async () => {
    const { runId } = await readRunContext();
    const room401 = ctx.room401 ?? '';
    const tenantA = ctx.tenantA?.page;
    const tenantB = ctx.tenantB?.page;
    if (tenantA === undefined || tenantB === undefined) throw new Error('Tenant sessions are missing.');
    const before = await probeMessageCount(`E2E-${runId}-401`);
    const fixture = await buildValidImage('png', 16);
    const pending = await mintIntent(tenantA.request, {
      scope: 'CHAT',
      entityRef: { type: 'chat_message', id: null },
      contentType: fixture.contentType,
      fileName: `e2e-${runId}-chat-pending.png`,
    });
    expect(pending.status).toBe(200);
    const pendingSend = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      imageId: pending.json.data.imageId,
    });
    expect(pendingSend.status).toBe(400);
    const foreignFixture = await buildValidImage('png', 16);
    const foreign = await mintIntent(tenantA.request, {
      scope: 'MAINTENANCE',
      entityRef: { type: 'owner', id: null },
      contentType: foreignFixture.contentType,
      fileName: `e2e-${runId}-chat-scope.png`,
    });
    expect(foreign.status).toBe(200);
    expect(await putBytes(foreign.json.data.uploadUrl, foreignFixture.contentType, foreignFixture.bytes)).toBeLessThan(300);
    const foreignReady = await completeUpload(tenantA.request, foreign.json.data.imageId);
    expect(foreignReady.status).toBe(200);
    const foreignSend = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      imageId: foreign.json.data.imageId,
    });
    expect(foreignSend.status).toBe(400);
    const outsiderFixture = await buildValidImage('png', 16);
    const outsiderIntent = await mintIntent(tenantB.request, {
      scope: 'CHAT',
      entityRef: { type: 'chat_message', id: null },
      contentType: outsiderFixture.contentType,
      fileName: `e2e-${runId}-chat-owner.png`,
    });
    expect(outsiderIntent.status).toBe(200);
    expect(await putBytes(outsiderIntent.json.data.uploadUrl, outsiderFixture.contentType, outsiderFixture.bytes)).toBeLessThan(300);
    const outsiderReady = await completeUpload(tenantB.request, outsiderIntent.json.data.imageId);
    expect(outsiderReady.status).toBe(200);
    const outsiderSend = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      imageId: outsiderIntent.json.data.imageId,
    });
    expect(outsiderSend.status).toBe(400);
    expect(await probeMessageCount(`E2E-${runId}-401`)).toBe(before);
    expect(await putBytes(pending.json.data.uploadUrl, fixture.contentType, fixture.bytes)).toBeLessThan(300);
    const pendingReady = await completeUpload(tenantA.request, pending.json.data.imageId);
    expect(pendingReady.status).toBe(200);
    expect(pendingReady.json.data.state).toBe('READY');
  });

  test('ut-ch-03 live: same clientMessageId replayed 3 times returns one row and one id', async () => {
    const { runId } = await readRunContext();
    const room401 = ctx.room401 ?? '';
    const tenantA = ctx.tenantA?.page;
    if (tenantA === undefined) throw new Error('Tenant A session is missing.');
    const before = await probeMessageCount(`E2E-${runId}-401`);
    const key = randomUUID();
    ctx.replayKey = key;
    const first = await postMessage(tenantA.request, room401, {
      clientMessageId: key,
      text: 'Replay-safe message.',
    });
    expect(first.status).toBe(200);
    const firstId = asChatSend(first.json).data.id;
    ctx.replayMessageId = firstId;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const replayed = await postMessage(tenantA.request, room401, {
        clientMessageId: key,
        text: 'Replay-safe message.',
      });
      expect(replayed.status).toBe(200);
      expect(asChatSend(replayed.json).data.id).toBe(firstId);
    }
    expect(await probeMessageCount(`E2E-${runId}-401`)).toBe(before + 1);
  });

  test('owner blackout, outsider conceal, suspended and first-login denies', async ({ page, browser }) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    const room401 = ctx.room401 ?? '';
    const room406 = ctx.room406 ?? '';
    await loginAsPoolAdmin(page, 'chatsend');
    const outsider = ctx.outsider?.page;
    const suspended = ctx.suspended?.page;
    const firstLogin = ctx.firstLogin?.page;
    if (outsider === undefined || suspended === undefined || firstLogin === undefined) {
      throw new Error('Deny sessions are missing.');
    }
    const safeRun = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const ownerUsername = `e2e${safeRun}ownera`.slice(0, 30);
    const searched = await apiJson<{
      data: Array<{ id: string; username: string }>;
    }>(page.request, {
      method: 'GET',
      path: `/api/admin/users?query=${encodeURIComponent(ownerUsername)}&page=1&pageSize=10`,
    });
    expect(searched.status).toBe(200);
    const ownerUser = searched.json.data.find((entry) => entry.username === ownerUsername);
    if (ownerUser === undefined) throw new Error('Seed owner was not found.');
    const reset = await apiJson<{ data: { tempPassword: string } }>(page.request, {
      method: 'POST',
      path: `/api/admin/users/${ownerUser.id}/reset-password`,
      body: {},
    });
    expect(reset.status).toBe(200);
    const ownerContext = await browser.newContext({ baseURL });
    const ownerPage = await ownerContext.newPage();
    try {
      await completeFirstLogin(ownerPage, {
        username: ownerUsername,
        tempPassword: reset.json.data.tempPassword,
        newPassword: `Cht-${safeRun}-pw1`,
      });
      const blackout = await postMessage(ownerPage.request, room406, {
        clientMessageId: randomUUID(),
        text: 'Owner note during active tenancy.',
      });
      expect(blackout.status).toBe(404);
      expect(asChatError(blackout.json).error.code).toBe('RESOURCE_NOT_FOUND');
      const blackoutList = await listMessages(ownerPage.request, room406);
      expect(blackoutList.status).toBe(404);
      expect(asChatError(blackoutList.json).error.code).toBe('RESOURCE_NOT_FOUND');
    } finally {
      await ownerContext.close();
    }
    const concealed = await postMessage(outsider.request, room401, {
      clientMessageId: randomUUID(),
      text: 'Outsider note.',
    });
    expect(concealed.status).toBe(404);
    expect(asChatError(concealed.json).error.code).toBe('RESOURCE_NOT_FOUND');
    const deniedSuspended = await postMessage(suspended.request, room401, {
      clientMessageId: randomUUID(),
      text: 'Suspended note.',
    });
    expect(deniedSuspended.status).toBe(401);
    expect(asChatError(deniedSuspended.json).error.code).toBe('AUTH_REQUIRED');
    const deniedFirstLogin = await postMessage(firstLogin.request, room401, {
      clientMessageId: randomUUID(),
      text: 'First-login note.',
    });
    expect(deniedFirstLogin.status).toBe(403);
    expect(asChatError(deniedFirstLogin.json).error.code).toBe('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  });

  test('admin send 200 with admin sender snapshot', async ({ page }) => {
    const room401 = ctx.room401 ?? '';
    await loginAsPoolAdmin(page, 'chatsend');
    const sent = await postMessage(page.request, room401, {
      clientMessageId: randomUUID(),
      text: 'Admin notice to the room.',
    });
    expect(sent.status).toBe(200);
    const dto = asChatSend(sent.json).data;
    expect(dto.senderIsAdmin).toBe(true);
    expect(dto.senderName.length).toBeGreaterThan(0);
  });

  test('chat image reads: member and admin read, outsider denied, no url field', async ({ page }) => {
    const room401 = ctx.room401 ?? '';
    await loginAsPoolAdmin(page, 'chatsend');
    const tenantA = ctx.tenantA?.page;
    const outsider = ctx.outsider?.page;
    if (tenantA === undefined || outsider === undefined) throw new Error('Image sessions are missing.');
    const imageId = await mintReadyChatImage(tenantA, `e2e-${(await readRunContext()).runId}-chat-read.png`);
    const sent = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      imageId,
    });
    expect(sent.status).toBe(200);
    const memberAccess = await readAccess(tenantA.request, imageId);
    expect(memberAccess.status).toBe(200);
    const adminAccess = await readAccess(page.request, imageId);
    expect(adminAccess.status).toBe(200);
    const outsiderAccess = await readAccess(outsider.request, imageId);
    expect(outsiderAccess.status).toBe(403);
    expect(asChatError(outsiderAccess.json).error.code).toBe('ACCESS_DENIED');
    expect('url' in (outsiderAccess.json as Record<string, unknown>)).toBe(false);
  });

  test('rate bucket: 30 per minute per user and room then 429 with Retry-After', async ({ page }) => {
    const room401 = ctx.room401 ?? '';
    await loginAsPoolAdmin(page, 'chatsend');
    const tenantB = ctx.tenantB?.page;
    if (tenantB === undefined) throw new Error('Tenant B session is missing.');
    const detail = await apiJson<{
      data: { tenancies: Array<{ id: string; state: string }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room401}` });
    expect(detail.status).toBe(200);
    const tenancy = detail.json.data.tenancies.find((entry) => entry.state === 'ACTIVE');
    if (tenancy === undefined) throw new Error('Room 401 has no active tenancy.');
    const joined = await apiJson<{ data: { userId: string } }>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room401}/members`,
      body: { userId: ctx.tenantB?.userId ?? '', memberRole: 'SUB', tenancyId: tenancy.id },
    });
    expect(joined.status).toBe(200);
    let limitedAt = -1;
    let retryAfter: string | null = null;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const response = await tenantB.request.fetch(`/api/rooms/${room401}/messages`, {
        method: 'POST',
        data: { clientMessageId: randomUUID(), text: `Rate probe ${attempt}.` },
        headers: { 'content-type': 'application/json' },
      });
      if (response.status() === 429) {
        limitedAt = attempt;
        retryAfter = response.headers()['retry-after'] ?? null;
        break;
      }
      expect(response.status()).toBe(200);
    }
    expect(limitedAt).toBeGreaterThanOrEqual(30);
    expect(retryAfter).not.toBeNull();
  });

  test('ex-resident send 404 after membership end', async ({ page }) => {
    const room401 = ctx.room401 ?? '';
    await loginAsPoolAdmin(page, 'chatsend');
    const tenantA = ctx.tenantA?.page;
    if (tenantA === undefined) throw new Error('Tenant A session is missing.');
    const detail = await apiJson<{
      data: { memberships: Array<{ id: string; userId: string; endAt: string | null }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room401}` });
    expect(detail.status).toBe(200);
    const membership = detail.json.data.memberships.find(
      (entry) => entry.userId === (ctx.tenantA?.userId ?? '') && entry.endAt === null,
    );
    if (membership === undefined) throw new Error('Tenant A has no open membership in 401.');
    const ended = await apiJson<{ data: { endAt: string | null } }>(page.request, {
      method: 'PATCH',
      path: `/api/rooms/${room401}/members/${membership.id}`,
      body: { action: 'END' },
    });
    expect(ended.status).toBe(200);
    const denied = await postMessage(tenantA.request, room401, {
      clientMessageId: randomUUID(),
      text: 'Ex-resident note.',
    });
    expect(denied.status).toBe(404);
    expect(asChatError(denied.json).error.code).toBe('RESOURCE_NOT_FOUND');
    const deniedList = await listMessages(tenantA.request, room401);
    expect(deniedList.status).toBe(404);
    expect(asChatError(deniedList.json).error.code).toBe('RESOURCE_NOT_FOUND');
  });

  test.afterAll(async () => {
    await ctx.tenantA?.close();
    await ctx.tenantB?.close();
    await ctx.outsider?.close();
    await ctx.suspended?.close();
    await ctx.firstLogin?.close();
  });
});
