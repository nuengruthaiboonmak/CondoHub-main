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

interface VisibilityCtx {
  room402: string;
  room403: string;
  room407: string;
  room409: string;
  room412: string;
  tenantB: ActorSession;
  lateTenant: ActorSession;
}

const ctx: Partial<VisibilityCtx> = {};

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

test.describe('chat visibility: turnover, rejoin gap, owner blackout, ex-resident', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision late joiners for the visibility rooms', async ({ page, browser }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatvisibility');
    ctx.room402 = await findChatRoom(page, `E2E-${runId}-402`);
    ctx.room403 = await findChatRoom(page, `E2E-${runId}-403`);
    ctx.room407 = await findChatRoom(page, `E2E-${runId}-407`);
    ctx.room409 = await findChatRoom(page, `E2E-${runId}-409`);
    ctx.room412 = await findChatRoom(page, `E2E-${runId}-412`);
    const tenantB = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtvisb');
    const lateTenant = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtvisl');
    ctx.tenantB = tenantB;
    ctx.lateTenant = lateTenant;
    await joinRoom(page, ctx.room407 ?? '', tenantB.userId, 'SUB');
  });

  test('ut-ch-01 live: rejoin gap actor sees both segments but never the gap message', async ({
    page,
    browser,
  }) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatvisibility');
    const room402 = ctx.room402 ?? '';
    const safeRun = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const gapUsername = `e2e${safeRun}chatgap`.slice(0, 30);
    const searched = await apiJson<{
      data: Array<{ id: string; username: string }>;
    }>(page.request, {
      method: 'GET',
      path: `/api/admin/users?query=${encodeURIComponent(gapUsername)}&page=1&pageSize=10`,
    });
    expect(searched.status).toBe(200);
    const gapUser = searched.json.data.find((entry) => entry.username === gapUsername);
    if (gapUser === undefined) throw new Error('Seed gap actor was not found.');
    const reset = await apiJson<{ data: { tempPassword: string } }>(page.request, {
      method: 'POST',
      path: `/api/admin/users/${gapUser.id}/reset-password`,
      body: {},
    });
    expect(reset.status).toBe(200);
    const gapContext = await browser.newContext({ baseURL });
    const gapPage = await gapContext.newPage();
    try {
      await completeFirstLogin(gapPage, {
        username: gapUsername,
        tempPassword: reset.json.data.tempPassword,
        newPassword: `Cht-${safeRun}-pw1`,
      });
      const listed = await listMessages(gapPage.request, room402, '?limit=50');
      expect(listed.status).toBe(200);
      const texts = asChatList(listed.json).data.map((entry) => entry.text ?? '');
      expect(texts.some((entry) => entry.includes('Early segment note'))).toBe(true);
      expect(texts.some((entry) => entry.includes('Late segment note'))).toBe(true);
      expect(texts.some((entry) => entry.includes('Blackout window control'))).toBe(true);
      expect(texts.some((entry) => entry.includes('Gap-day control'))).toBe(false);
    } finally {
      await gapContext.close();
    }
  });

  test('golden-6 list legs: tenant B post-start only, admin full history', async ({ page }) => {
    const room403 = ctx.room403 ?? '';
    await loginAsPoolAdmin(page, 'chatvisibility');
    const tenantB = ctx.tenantB?.page;
    if (tenantB === undefined) throw new Error('Tenant B session is missing.');
    const listed = await listMessages(tenantB.request, room403);
    expect(listed.status).toBe(404);
    const adminListed = await listMessages(page.request, room403);
    expect(adminListed.status).toBe(200);
    expect(asChatList(adminListed.json).data).toHaveLength(0);
  });

  test('tenant B joins after a message: sees only post-start history on the same conversation', async ({
    page,
  }) => {
    const room403 = ctx.room403 ?? '';
    await loginAsPoolAdmin(page, 'chatvisibility');
    const tenantB = ctx.tenantB?.page;
    if (tenantB === undefined) throw new Error('Tenant B session is missing.');
    const early = await postMessage(page.request, room403, {
      clientMessageId: randomUUID(),
      text: 'Admin note before tenant B joins.',
    });
    expect(early.status).toBe(200);
    const earlyId = asChatSend(early.json).data.id;
    await joinRoom(page, room403, ctx.tenantB?.userId ?? '', 'SUB');
    const listed = await listMessages(tenantB.request, room403);
    expect(listed.status).toBe(200);
    expect(asChatList(listed.json).data.map((entry) => entry.id)).not.toContain(earlyId);
    const late = await postMessage(page.request, room403, {
      clientMessageId: randomUUID(),
      text: 'Admin note after tenant B joins.',
    });
    expect(late.status).toBe(200);
    const relisted = await listMessages(tenantB.request, room403);
    expect(relisted.status).toBe(200);
    const ids = asChatList(relisted.json).data.map((entry) => entry.id);
    expect(ids).toContain(asChatSend(late.json).data.id);
    expect(ids).not.toContain(earlyId);
    const adminListed = await listMessages(page.request, room403);
    expect(adminListed.status).toBe(200);
    const adminIds = asChatList(adminListed.json).data.map((entry) => entry.id);
    expect(adminIds).toContain(earlyId);
    expect(adminIds).toContain(asChatSend(late.json).data.id);
  });

  test('ut-ch-02 live: owner sees vacancy segments only across the blackout window', async ({
    page,
    browser,
  }) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    const room412 = ctx.room412 ?? '';
    await loginAsPoolAdmin(page, 'chatvisibility');
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
      const before = await listMessages(ownerPage.request, room412, '?limit=50');
      expect(before.status).toBe(200);
      const beforeTexts = asChatList(before.json).data.map((entry) => entry.text ?? '');
      expect(beforeTexts.some((entry) => entry.includes('Tenancy window control'))).toBe(false);
      const vacancyNote = await postMessage(ownerPage.request, room412, {
        clientMessageId: randomUUID(),
        text: 'Owner note in the new vacancy.',
      });
      expect(vacancyNote.status).toBe(200);
      const after = await listMessages(ownerPage.request, room412, '?limit=50');
      expect(after.status).toBe(200);
      const afterRows = asChatList(after.json).data;
      expect(afterRows.map((entry) => entry.id)).toContain(asChatSend(vacancyNote.json).data.id);
      expect(afterRows.map((entry) => entry.text ?? '').some((entry) => entry.includes('Tenancy window control'))).toBe(
        false,
      );
      const tenanted = await listMessages(ownerPage.request, ctx.room403 ?? '');
      expect(tenanted.status).toBe(404);
    } finally {
      await ownerContext.close();
    }
  });

  test('ex-resident list 404 on a room with visible history', async ({ page }) => {
    const room409 = ctx.room409 ?? '';
    await loginAsPoolAdmin(page, 'chatvisibility');
    const lateTenant = ctx.lateTenant?.page;
    if (lateTenant === undefined) throw new Error('Late tenant session is missing.');
    await joinRoom(page, room409, ctx.lateTenant?.userId ?? '', 'SUB');
    const sent = await postMessage(lateTenant.request, room409, {
      clientMessageId: randomUUID(),
      text: 'History note the ex-resident must not read.',
    });
    expect(sent.status).toBe(200);
    const detail = await apiJson<{
      data: { memberships: Array<{ id: string; userId: string; endAt: string | null }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room409}` });
    expect(detail.status).toBe(200);
    const membership = detail.json.data.memberships.find(
      (entry) => entry.userId === (ctx.lateTenant?.userId ?? '') && entry.endAt === null,
    );
    if (membership === undefined) throw new Error('Late tenant has no open membership in 409.');
    const ended = await apiJson<{ data: { endAt: string | null } }>(page.request, {
      method: 'PATCH',
      path: `/api/rooms/${room409}/members/${membership.id}`,
      body: { action: 'END' },
    });
    expect(ended.status).toBe(200);
    const denied = await listMessages(lateTenant.request, room409);
    expect(denied.status).toBe(404);
    expect(asChatError(denied.json).error.code).toBe('RESOURCE_NOT_FOUND');
  });

  test.afterAll(async () => {
    await ctx.tenantB?.close();
    await ctx.lateTenant?.close();
  });
});
