import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsPoolAdmin, provisionUser } from '../../helpers/owner';
import { asChatError, asChatList, asChatSend, findChatRoom, listMessages, postMessage } from './chatFlow';

interface ActorSession {
  userId: string;
  username: string;
  password: string;
  page: Page;
  close: () => Promise<void>;
}

interface ListCtx {
  room404: string;
  room413: string;
  room414: string;
  tenant: ActorSession;
  observer: { page: Page; close: () => Promise<void> };
  outsider: ActorSession;
}

const ctx: Partial<ListCtx> = {};

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

test.describe('chat list: pagination, cursors, denies', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision reader actors and join pagination rooms', async ({ page, browser }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatlist');
    const room404 = await findChatRoom(page, `E2E-${runId}-404`);
    const room413 = await findChatRoom(page, `E2E-${runId}-413`);
    const room414 = await findChatRoom(page, `E2E-${runId}-414`);
    ctx.room404 = room404;
    ctx.room413 = room413;
    ctx.room414 = room414;
    const tenant = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtlstt');
    const outsider = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtlsto');
    ctx.tenant = tenant;
    ctx.outsider = outsider;
    await joinRoom(page, room413, tenant.userId, 'SUB');
    await joinRoom(page, room414, tenant.userId, 'SUB');
    await joinRoom(page, room404, tenant.userId, 'SUB');
    const safeRun = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const observerUsername = `e2e${safeRun}chatobv`.slice(0, 30);
    const searched = await apiJson<{
      data: Array<{ id: string; username: string }>;
    }>(page.request, {
      method: 'GET',
      path: `/api/admin/users?query=${encodeURIComponent(observerUsername)}&page=1&pageSize=10`,
    });
    expect(searched.status).toBe(200);
    const observerUser = searched.json.data.find((entry) => entry.username === observerUsername);
    if (observerUser === undefined) throw new Error('Seed observer was not found.');
    const reset = await apiJson<{ data: { tempPassword: string } }>(page.request, {
      method: 'POST',
      path: `/api/admin/users/${observerUser.id}/reset-password`,
      body: {},
    });
    expect(reset.status).toBe(200);
    const observerContext = await browser.newContext({ baseURL });
    const observerPage = await observerContext.newPage();
    await completeFirstLogin(observerPage, {
      username: observerUsername,
      tempPassword: reset.json.data.tempPassword,
      newPassword: `Cht-${safeRun}-pw1`,
    });
    ctx.observer = { page: observerPage, close: () => observerContext.close() };
  });

  test('empty room returns 200 with empty list and no cursor', async () => {
    const room404 = ctx.room404 ?? '';
    const tenant = ctx.tenant?.page;
    if (tenant === undefined) throw new Error('Tenant session is missing.');
    const listed = await listMessages(tenant.request, room404);
    expect(listed.status).toBe(200);
    const dto = asChatList(listed.json);
    expect(dto.data).toHaveLength(0);
    expect(dto.meta.nextCursor).toBeUndefined();
  });

  test('latest 30 default newest-first with nextCursor across seeded history', async () => {
    const room413 = ctx.room413 ?? '';
    const observer = ctx.observer?.page;
    if (observer === undefined) throw new Error('Observer session is missing.');
    const listed = await listMessages(observer.request, room413);
    expect(listed.status).toBe(200);
    const dto = asChatList(listed.json);
    expect(dto.data).toHaveLength(30);
    expect(dto.meta.nextCursor).toBeDefined();
    const stamps = dto.data.map((entry) => entry.createdAt);
    const sorted = [...stamps].sort().reverse();
    expect(stamps).toEqual(sorted);
  });

  test('before paging walks history deterministically without overlap', async () => {
    const room413 = ctx.room413 ?? '';
    const observer = ctx.observer?.page;
    if (observer === undefined) throw new Error('Observer session is missing.');
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const listed = await listMessages(
        observer.request,
        room413,
        cursor === undefined ? '' : `?before=${encodeURIComponent(cursor)}`,
      );
      expect(listed.status).toBe(200);
      const dto = asChatList(listed.json);
      pages += 1;
      for (const entry of dto.data) {
        expect(seen.has(entry.id)).toBe(false);
        seen.add(entry.id);
      }
      const next = dto.meta.nextCursor;
      if (next === undefined || dto.data.length === 0) break;
      cursor = next;
      if (pages > 10) throw new Error('Pagination walked too many pages.');
    }
    expect(seen.size).toBeGreaterThanOrEqual(65);
  });

  test('ms-chat-02 http leg: after cursor resyncs forward oldest-first', async () => {
    const room414 = ctx.room414 ?? '';
    const tenant = ctx.tenant?.page;
    if (tenant === undefined) throw new Error('Tenant session is missing.');
    const first = await postMessage(tenant.request, room414, {
      clientMessageId: randomUUID(),
      text: 'Resync anchor message.',
    });
    expect(first.status).toBe(200);
    const anchor = asChatSend(first.json).data;
    const second = await postMessage(tenant.request, room414, {
      clientMessageId: randomUUID(),
      text: 'Resync follow-up one.',
    });
    expect(second.status).toBe(200);
    const third = await postMessage(tenant.request, room414, {
      clientMessageId: randomUUID(),
      text: 'Resync follow-up two.',
    });
    expect(third.status).toBe(200);
    const listed = await listMessages(tenant.request, room414, '?limit=50');
    expect(listed.status).toBe(200);
    const rows = asChatList(listed.json).data;
    const anchorCursor = Buffer.from(
      JSON.stringify({ createdAt: anchor.createdAt, id: anchor.id }),
      'utf8',
    ).toString('base64url');
    const resynced = await listMessages(tenant.request, room414, `?after=${anchorCursor}&limit=50`);
    expect(resynced.status).toBe(200);
    const forward = asChatList(resynced.json).data;
    expect(forward.length).toBeGreaterThanOrEqual(2);
    expect(forward.map((entry) => entry.id)).toContain(asChatSend(second.json).data.id);
    expect(forward.map((entry) => entry.id)).toContain(asChatSend(third.json).data.id);
    const stamps = forward.map((entry) => entry.createdAt);
    expect(stamps).toEqual([...stamps].sort());
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  test('outsider conceal, malformed before, before-plus-after, limit bounds', async () => {
    const room413 = ctx.room413 ?? '';
    const outsider = ctx.outsider?.page;
    const tenant = ctx.tenant?.page;
    if (outsider === undefined || tenant === undefined) throw new Error('List sessions are missing.');
    const concealed = await listMessages(outsider.request, room413);
    expect(concealed.status).toBe(404);
    expect(asChatError(concealed.json).error.code).toBe('RESOURCE_NOT_FOUND');
    const malformed = await listMessages(tenant.request, room413, '?before=not-a-cursor');
    expect(malformed.status).toBe(400);
    expect(asChatError(malformed.json).error.code).toBe('VALIDATION_ERROR');
    const both = await listMessages(tenant.request, room413, '?before=abc&after=def');
    expect(both.status).toBe(400);
    expect(asChatError(both.json).error.code).toBe('VALIDATION_ERROR');
    const fifty = await listMessages(tenant.request, room413, '?limit=50');
    expect(fifty.status).toBe(200);
    expect(asChatList(fifty.json).data.length).toBeLessThanOrEqual(50);
    const fiftyOne = await listMessages(tenant.request, room413, '?limit=51');
    expect(fiftyOne.status).toBe(400);
    expect(asChatError(fiftyOne.json).error.code).toBe('VALIDATION_ERROR');
  });

  test.afterAll(async () => {
    await ctx.tenant?.close();
    await ctx.observer?.close();
    await ctx.outsider?.close();
  });
});
