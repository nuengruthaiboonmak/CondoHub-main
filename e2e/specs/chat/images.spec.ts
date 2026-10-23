import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsPoolAdmin, provisionUser } from '../../helpers/owner';
import { buildValidImage } from '../../helpers/announcementFiles';
import { completeUpload, mintIntent, putBytes, readAccess } from '../upload/uploadFlow';
import { asChatError, asChatSend, findChatRoom, postMessage } from './chatFlow';

interface ActorSession {
  userId: string;
  username: string;
  password: string;
  page: Page;
  close: () => Promise<void>;
}

interface ImagesCtx {
  room410: string;
  room415: string;
  sender: ActorSession;
  member: ActorSession;
  outsider: ActorSession;
  imageId: string;
  otherImageId: string;
}

const ctx: Partial<ImagesCtx> = {};

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

async function joinRoom(adminPage: Page, roomId: string, userId: string, memberRole: string): Promise<void> {
  const detail = await apiJson<{
    data: { tenancies: Array<{ id: string; state: string }> };
  }>(adminPage.request, { method: 'GET', path: `/api/rooms/${roomId}` });
  expect(detail.status).toBe(200);
  const tenancy = detail.json.data.tenancies.find((entry) => entry.state === 'ACTIVE');
  if (tenancy === undefined) throw new Error('Room has no active tenancy.');
  const joined = await apiJson<{ data: { userId: string } }>(adminPage.request, {
    method: 'POST',
    path: `/api/rooms/${roomId}/members`,
    body: { userId, memberRole, tenancyId: tenancy.id },
  });
  expect(joined.status).toBe(200);
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

test.describe('chat images: attached reads, revoke deny, cross-room guess deny', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision image actors and join 410 plus cross-room 415', async (
    { page, browser },
    testInfo,
  ) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatimages');
    ctx.room410 = await findChatRoom(page, `E2E-${runId}-410`);
    ctx.room415 = await findChatRoom(page, `E2E-${runId}-415`);
    const sender = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtimgs');
    const member = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtimgm');
    const outsider = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtimgo');
    ctx.sender = sender;
    ctx.member = member;
    ctx.outsider = outsider;
    await joinRoom(page, ctx.room410 ?? '', sender.userId, 'MAIN');
    await joinRoom(page, ctx.room410 ?? '', member.userId, 'SUB');
    await joinRoom(page, ctx.room415 ?? '', outsider.userId, 'SUB');
    const imageId = await mintReadyChatImage(sender.page, `e2e-${runId}-chat-img.png`);
    const sent = await postMessage(sender.page.request, ctx.room410 ?? '', {
      clientMessageId: randomUUID(),
      imageId,
    });
    expect(sent.status).toBe(200);
    expect(asChatSend(sent.json).data.imageId).toBe(imageId);
    ctx.imageId = imageId;
    const otherImage = await mintReadyChatImage(outsider.page, `e2e-${runId}-chat-other.png`);
    const otherSent = await postMessage(outsider.page.request, ctx.room415 ?? '', {
      clientMessageId: randomUUID(),
      imageId: otherImage,
    });
    expect(otherSent.status).toBe(200);
    ctx.otherImageId = otherImage;
  });

  test('attached chat image readable by current member and admin', async ({ page }) => {
    await loginAsPoolAdmin(page, 'chatimages');
    const member = ctx.member?.page;
    const imageId = ctx.imageId ?? '';
    if (member === undefined) throw new Error('Member session is missing.');
    const memberAccess = await readAccess(member.request, imageId);
    expect(memberAccess.status).toBe(200);
    expect(memberAccess.json.data.url.length).toBeGreaterThan(0);
    const adminAccess = await readAccess(page.request, imageId);
    expect(adminAccess.status).toBe(200);
  });

  test('cross-room id guess denied with no url field', async () => {
    const member = ctx.member?.page;
    const otherImageId = ctx.otherImageId ?? '';
    if (member === undefined) throw new Error('Member session is missing.');
    const guessed = await readAccess(member.request, otherImageId);
    expect(guessed.status).toBe(403);
    expect(asChatError(guessed.json).error.code).toBe('ACCESS_DENIED');
    expect('url' in (guessed.json as Record<string, unknown>)).toBe(false);
  });

  test('revoked member denied after membership end', async ({ page }) => {
    const room410 = ctx.room410 ?? '';
    await loginAsPoolAdmin(page, 'chatimages');
    const member = ctx.member?.page;
    const imageId = ctx.imageId ?? '';
    if (member === undefined) throw new Error('Member session is missing.');
    const detail = await apiJson<{
      data: { memberships: Array<{ id: string; userId: string; endAt: string | null }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room410}` });
    expect(detail.status).toBe(200);
    const membership = detail.json.data.memberships.find(
      (entry) => entry.userId === (ctx.member?.userId ?? '') && entry.endAt === null,
    );
    if (membership === undefined) throw new Error('Member has no open membership in 410.');
    const ended = await apiJson<{ data: { endAt: string | null } }>(page.request, {
      method: 'PATCH',
      path: `/api/rooms/${room410}/members/${membership.id}`,
      body: { action: 'END' },
    });
    expect(ended.status).toBe(200);
    const denied = await readAccess(member.request, imageId);
    expect(denied.status).toBe(403);
    expect(asChatError(denied.json).error.code).toBe('ACCESS_DENIED');
    expect('url' in (denied.json as Record<string, unknown>)).toBe(false);
  });

  test.afterAll(async () => {
    await ctx.sender?.close();
    await ctx.member?.close();
    await ctx.outsider?.close();
  });
});
