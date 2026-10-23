import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsPoolAdmin, provisionUser } from '../../helpers/owner';
import { buildValidImage } from '../../helpers/announcementFiles';
import { asChatList, asChatSend, findChatRoom, listMessages, postMessage } from './chatFlow';

interface ActorSession {
  userId: string;
  username: string;
  page: Page;
  close: () => Promise<void>;
}

interface ScreensCtx {
  runId: string;
  room301: string;
  room302: string;
  room303: string;
  residentA: ActorSession;
  residentB: ActorSession;
  outsider: ActorSession;
  photoPath: string;
  textMessageId: string;
  imageMessageId: string;
}

const ctx: Partial<ScreensCtx> = {};

function actorUsername(runId: string, workerIndex: number, stem: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `e2e${suffix}${stem}${workerIndex}`.slice(0, 30);
}

function actorPassword(runId: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `Csc-${suffix}-pw1`;
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
  const provisioned = await provisionUser(adminPage, {
    username,
    name: `Chat Screens ${stem} ${runId}`,
  });
  const password = actorPassword(runId);
  const context = await browser.newContext({ baseURL });
  const userPage = await context.newPage();
  await completeFirstLogin(userPage, {
    username,
    tempPassword: provisioned.tempPassword,
    newPassword: password,
  });
  return { userId: provisioned.userId, username, page: userPage, close: () => context.close() };
}

async function joinRoom(
  adminPage: Page,
  roomId: string,
  userId: string,
  memberRole: string,
): Promise<void> {
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

async function endMembership(
  adminRequest: ActorSession['page']['request'],
  roomId: string,
  userId: string,
): Promise<void> {
  const detail = await apiJson<{
    data: { memberships: Array<{ id: string; userId: string; endAt: string | null }> };
  }>(adminRequest, { method: 'GET', path: `/api/rooms/${roomId}` });
  expect(detail.status).toBe(200);
  const membership = detail.json.data.memberships.find(
    (entry) => entry.userId === userId && entry.endAt === null,
  );
  if (membership === undefined) throw new Error('Actor has no open membership.');
  const ended = await apiJson<{ data: { endAt: string | null } }>(adminRequest, {
    method: 'PATCH',
    path: `/api/rooms/${roomId}/members/${membership.id}`,
    body: { action: 'END' },
  });
  expect(ended.status).toBe(200);
}

async function writePhotoFixture(prefix: string): Promise<string> {
  const fixture = await buildValidImage('png', 32);
  const filePath = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`,
  );
  await fs.writeFile(filePath, fixture.bytes);
  return filePath;
}

async function messageIds(
  request: ActorSession['page']['request'],
  roomId: string,
): Promise<string[]> {
  const listed = await listMessages(request, roomId, '?limit=50');
  expect(listed.status).toBe(200);
  return asChatList(listed.json).data.map((entry) => entry.id);
}

test.describe('chat screens: composer, backfill, pill, retry, revoke, denies', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision actors, join 301/302/303, seed one control message', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    ctx.runId = runId;
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatscreens');
    ctx.room301 = await findChatRoom(page, `E2E-${runId}-301`);
    ctx.room302 = await findChatRoom(page, `E2E-${runId}-302`);
    ctx.room303 = await findChatRoom(page, `E2E-${runId}-303`);
    const residentA = await provisionActor(
      page,
      browser,
      baseURL,
      runId,
      testInfo.workerIndex,
      'chtscra',
    );
    const residentB = await provisionActor(
      page,
      browser,
      baseURL,
      runId,
      testInfo.workerIndex,
      'chtscrb',
    );
    const outsider = await provisionActor(
      page,
      browser,
      baseURL,
      runId,
      testInfo.workerIndex,
      'chtscro',
    );
    ctx.residentA = residentA;
    ctx.residentB = residentB;
    ctx.outsider = outsider;
    await joinRoom(page, ctx.room301 ?? '', residentA.userId, 'MAIN');
    await joinRoom(page, ctx.room301 ?? '', residentB.userId, 'SUB');
    await joinRoom(page, ctx.room302 ?? '', residentA.userId, 'MAIN');
    await joinRoom(page, ctx.room303 ?? '', residentA.userId, 'MAIN');
    await joinRoom(page, ctx.room303 ?? '', residentB.userId, 'SUB');
    const control = await postMessage(residentA.page.request, ctx.room303 ?? '', {
      clientMessageId: randomUUID(),
      text: `Screens control for run ${runId}.`,
    });
    expect(control.status).toBe(200);
    ctx.photoPath = await writePhotoFixture('chat-screens');
  });

  test('send text via composer lands in the list and pins via api', async () => {
    const room301 = ctx.room301 ?? '';
    const residentA = ctx.residentA?.page;
    if (residentA === undefined) throw new Error('Resident A session is missing.');
    const body = `Composer text run ${ctx.runId} ${Date.now()}.`;
    await residentA.goto(`/rooms/${room301}/chat`);
    await expect(residentA.getByTestId('chat-page')).toBeVisible();
    await expect(residentA.getByTestId('chat-title')).toHaveText('Room chat');
    await residentA.getByTestId('chat-composer-text').fill(body);
    await residentA.getByTestId('chat-composer-send').click();
    await expect(residentA.getByTestId('chat-list')).toContainText(body);
    let found: { id: string; type: string } | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const listed = await listMessages(residentA.request, room301, '?limit=50');
      expect(listed.status).toBe(200);
      found = asChatList(listed.json).data.find((entry) => entry.text === body);
      if (found !== undefined) break;
      await residentA.waitForTimeout(500);
    }
    expect(found?.type).toBe('TEXT');
    ctx.textMessageId = found?.id ?? '';
    const bubble = residentA.getByTestId(`chat-message-${ctx.textMessageId}-text`);
    await expect(bubble).toHaveText(body);
  });

  test('resident chat fits mobile screens and preserves multiline drafts', async () => {
    const resident = ctx.residentA?.page;
    if (resident === undefined) throw new Error('Resident A session is missing.');
    for (const viewport of [
      { width: 360, height: 640 },
      { width: 768, height: 800 },
      { width: 1366, height: 900 },
    ]) {
      await resident.setViewportSize(viewport);
      await resident.goto(`/rooms/${ctx.room301}/chat`);
      await expect(resident.getByTestId('chat-title')).toBeVisible();
      const composer = await resident.getByTestId('chat-composer').boundingBox();
      expect((composer?.y ?? 0) + (composer?.height ?? 0)).toBeLessThanOrEqual(
        viewport.height - (viewport.width < 768 ? 64 : 0),
      );
      expect(
        await resident.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      expect(
        await resident.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
      ).toBe(true);
      await resident.getByTestId('chat-composer-text').fill('First line');
      await resident.getByTestId('chat-composer-text').press('Shift+Enter');
      await resident.keyboard.type('Second line');
      await expect(resident.getByTestId('chat-composer-text')).toHaveValue(
        'First line\nSecond line',
      );
    }
  });

  test('send image via composer attaches one ready chat image and pins via api', async ({}, testInfo) => {
    const room301 = ctx.room301 ?? '';
    const residentA = ctx.residentA?.page;
    if (residentA === undefined) throw new Error('Resident A session is missing.');
    await residentA.goto(`/rooms/${room301}/chat`);
    await expect(residentA.getByTestId('chat-page')).toBeVisible();
    let releaseUpload: () => void = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await residentA.route('**/api/images/intents', async (route) => {
      await uploadGate;
      await route.continue();
    });
    await residentA.getByTestId('chat-composer-text').fill('');
    await residentA.getByTestId('chat-composer-upload-input').setInputFiles(ctx.photoPath ?? '');
    try {
      await expect(residentA.getByTestId('chat-composer-upload-progress')).toBeVisible();
      await residentA.getByTestId('chat-composer-text').fill('Draft while uploading');
      await residentA.getByTestId('chat-composer-text').press('Enter');
      await expect(residentA.getByTestId('chat-composer-send')).toBeDisabled();
      await expect(residentA.getByTestId('chat-composer-text')).toHaveValue(
        'Draft while uploading',
      );
    } finally {
      releaseUpload();
    }
    await expect(residentA.getByTestId('chat-composer-attachment')).toBeVisible({ timeout: 30000 });
    await expect(residentA.getByTestId('chat-composer-preview')).toBeVisible();
    await residentA.getByTestId('chat-composer-text').fill('');
    await residentA.unroute('**/api/images/intents');
    await residentA.getByTestId('chat-composer-send').click();
    let images: Array<{ id: string; type: string; imageId: string | null }> = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const listed = await listMessages(residentA.request, room301, '?limit=50');
      expect(listed.status).toBe(200);
      images = asChatList(listed.json).data.filter((entry) => entry.type === 'IMAGE');
      if (images.length > 0) break;
      await residentA.waitForTimeout(500);
    }
    expect(images.length).toBeGreaterThan(0);
    const newest = images[0];
    if (newest === undefined) throw new Error('Image message was not created.');
    ctx.imageMessageId = newest.id;
    expect(newest.imageId).not.toBeNull();
    const bubble = residentA.getByTestId(`chat-message-${newest.id}-image`);
    await expect(bubble).toBeVisible({ timeout: 30000 });
    await expect(residentA.getByTestId(`chat-message-${newest.id}-image-open`)).toBeVisible();
    await residentA.getByTestId(`chat-message-${newest.id}-image-open`).click();
    await expect(residentA.getByTestId(`chat-message-${newest.id}-image-preview`)).toBeVisible();
    await residentA.getByTestId(`chat-message-${newest.id}-image-preview-close`).click();
    await expect(residentA.getByTestId(`chat-message-${newest.id}-image-preview`)).toHaveCount(0);
    for (const width of [360, 768, 1366]) {
      await residentA.setViewportSize({ width, height: 900 });
      const composer = await residentA.getByTestId('chat-composer').boundingBox();
      expect((composer?.y ?? 0) + (composer?.height ?? 0)).toBeLessThanOrEqual(
        900 - (width < 768 ? 64 : 0),
      );
      expect(
        await residentA.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await residentA.screenshot({
        path: testInfo.outputPath(`chat-conversation-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  });

  test('before-scroll backfill loads older history without moving the scroll anchor', async () => {
    const room302 = ctx.room302 ?? '';
    const residentA = ctx.residentA?.page;
    if (residentA === undefined) throw new Error('Resident A session is missing.');
    for (let index = 0; index < 35; index += 1) {
      const sent = await postMessage(residentA.request, room302, {
        clientMessageId: randomUUID(),
        text: `Backfill seed ${index} run ${ctx.runId}.`,
      });
      expect(sent.status).toBe(200);
    }
    await residentA.goto(`/rooms/${room302}/chat`);
    await expect(residentA.getByTestId('chat-page')).toBeVisible();
    const scroller = residentA.getByTestId('chat-scroll');
    await expect(scroller).toBeVisible();
    await expect(residentA.getByTestId('chat-load-older')).toBeVisible();
    await scroller.evaluate((node) => {
      node.scrollTop = 0;
    });
    const anchorRow = residentA.locator('[data-testid="chat-scroll"] > ul > li').first();
    await expect(anchorRow).toBeVisible();
    await residentA.waitForTimeout(800);
    const anchorKey = await anchorRow.getAttribute('data-message-id');
    expect(anchorKey).not.toBeNull();
    const anchorTopBefore = await anchorRow.evaluate((node) => node.getBoundingClientRect().top);
    await residentA.getByTestId('chat-load-older').click();
    await expect(residentA.getByText(`Backfill seed 0 run ${ctx.runId}.`)).toBeVisible();
    const anchorAfter = residentA.locator(`[data-message-id="${anchorKey ?? ''}"]`);
    await expect
      .poll(
        async () => {
          const top = await anchorAfter
            .evaluate((node) => node.getBoundingClientRect().top)
            .catch(() => -1);
          return Math.abs(top - anchorTopBefore);
        },
        { timeout: 10000 },
      )
      .toBeLessThan(8);
    const overflow = await scroller.evaluate(
      (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
    );
    expect(overflow).toBeGreaterThan(0);
    const listed = await listMessages(residentA.request, room302, '?limit=50');
    expect(listed.status).toBe(200);
    expect(asChatList(listed.json).data.length).toBeGreaterThanOrEqual(35);
  });

  test('new-message pill appears while scrolled up and jumps to the newest message', async ({
    page,
  }) => {
    await loginAsPoolAdmin(page, 'chatscreens');
    const room303 = ctx.room303 ?? '';
    const viewer = ctx.residentA?.page;
    const poster = ctx.residentB?.page;
    if (viewer === undefined || poster === undefined) throw new Error('Chat sessions are missing.');
    for (let index = 0; index < 25; index += 1) {
      const sent = await postMessage(viewer.request, room303, {
        clientMessageId: randomUUID(),
        text: `Pill padding ${index} run ${ctx.runId}.`,
      });
      expect(sent.status).toBe(200);
    }
    await viewer.goto(`/rooms/${room303}/chat`);
    await expect(viewer.getByTestId('chat-page')).toBeVisible();
    const scroller = viewer.getByTestId('chat-scroll');
    await scroller.evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect(viewer.getByTestId('chat-new-pill')).toHaveCount(0);
    const fresh = `Pill fresh run ${ctx.runId} ${Date.now()}.`;
    const sent = await postMessage(poster.request, room303, {
      clientMessageId: randomUUID(),
      text: fresh,
    });
    expect(sent.status).toBe(200);
    const freshDto = asChatSend(sent.json).data;
    await expect(viewer.getByTestId('chat-new-pill')).toBeVisible({ timeout: 30000 });
    await viewer.getByTestId('chat-new-pill').click();
    await expect(viewer.getByTestId(`chat-message-${freshDto.id}-text`)).toBeVisible();
    await expect(viewer.getByTestId(`chat-message-${freshDto.id}-text`)).toHaveText(fresh);
  });

  test('retry reuses the client message id and yields one message id via api', async () => {
    const room301 = ctx.room301 ?? '';
    const residentB = ctx.residentB?.page;
    if (residentB === undefined) throw new Error('Resident B session is missing.');
    await residentB.goto(`/rooms/${room301}/chat`);
    await expect(residentB.getByTestId('chat-page')).toBeVisible();
    const body = `Retry probe run ${ctx.runId} ${Date.now()}.`;
    await residentB.context().setOffline(true);
    try {
      await residentB.getByTestId('chat-composer-text').fill(body);
      await residentB.getByTestId('chat-composer-send').click();
      const pending = residentB.locator('[data-testid^="chat-pending-"]').first();
      await expect(pending).toBeVisible({ timeout: 15000 });
      const pendingTestId = (await pending.getAttribute('data-testid')) ?? '';
      const clientKey = pendingTestId.replace('chat-pending-', '');
      expect(clientKey).not.toBe('');
      await expect(residentB.getByTestId(`${pendingTestId}-state`)).toHaveText('Not sent', {
        timeout: 30000,
      });
      await residentB.context().setOffline(false);
      await residentB.getByTestId(`${pendingTestId}-retry`).click();
      await expect(residentB.getByTestId(pendingTestId)).toHaveCount(0, { timeout: 30000 });
      await expect(residentB.getByTestId('chat-list')).toContainText(body);
      const listed = await listMessages(residentB.request, room301, '?limit=50');
      expect(listed.status).toBe(200);
      const matches = asChatList(listed.json).data.filter((entry) => entry.text === body);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.clientMessageId).toBe(clientKey);
    } finally {
      await residentB.context().setOffline(false);
    }
  });

  test('membership end in another context toasts and redirects to my rooms', async ({ page }) => {
    await loginAsPoolAdmin(page, 'chatscreens');
    const room303 = ctx.room303 ?? '';
    const viewer = ctx.residentB?.page;
    if (viewer === undefined) throw new Error('Resident B session is missing.');
    await viewer.goto(`/rooms/${room303}/chat`);
    await expect(viewer.getByTestId('chat-page')).toBeVisible();
    await endMembership(page.request, room303, ctx.residentB?.userId ?? '');
    await expect(viewer.getByTestId('chat-revoked')).toBeVisible({ timeout: 30000 });
    await expect(viewer).toHaveURL(/\/rooms$/, { timeout: 30000 });
    await expect(viewer.getByTestId('my-rooms-page')).toBeVisible();
  });

  test('unknown room id shows generic missing copy without confirming existence', async () => {
    const viewer = ctx.residentA?.page;
    if (viewer === undefined) throw new Error('Resident A session is missing.');
    await viewer.goto(`/rooms/${randomUUID()}/chat`);
    await expect(viewer.getByTestId('chat-page')).toBeVisible();
    await expect(viewer.getByTestId('chat-denied')).toContainText('Chat not available');
    await viewer.goto('/rooms/00000000-0000-0000-0000-000000000000/chat');
    await expect(viewer.getByTestId('chat-page')).toBeVisible();
    await expect(viewer.getByTestId('chat-denied')).toContainText('Chat not available');
  });

  test('denied room for an outsider shows generic denied copy', async () => {
    const room301 = ctx.room301 ?? '';
    const outsider = ctx.outsider?.page;
    if (outsider === undefined) throw new Error('Outsider session is missing.');
    await outsider.goto(`/rooms/${room301}/chat`);
    await expect(outsider.getByTestId('chat-page')).toBeVisible();
    await expect(outsider.getByTestId('chat-denied')).toContainText('Chat not available');
    const ids = await messageIds(
      ctx.residentA?.page.request as ActorSession['page']['request'],
      room301,
    );
    expect(ids).toContain(ctx.textMessageId ?? '');
  });

  test.afterAll(async () => {
    await ctx.residentA?.close();
    await ctx.residentB?.close();
    await ctx.outsider?.close();
    if (ctx.photoPath !== undefined) await fs.rm(ctx.photoPath, { force: true });
  });
});
