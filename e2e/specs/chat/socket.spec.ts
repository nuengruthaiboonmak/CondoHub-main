import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsPoolAdmin, provisionUser } from '../../helpers/owner';
import { asChatList, asChatSend, findChatRoom, listMessages, postMessage } from './chatFlow';

interface ActorSession {
  userId: string;
  username: string;
  password: string;
  page: Page;
  close: () => Promise<void>;
}

interface SocketCtx {
  room405: string;
  room408: string;
  room415: string;
  room416: string;
  sender: ActorSession;
  receiver: ActorSession;
}

const ctx: Partial<SocketCtx> = {};

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

async function socketCookieHeader(page: Page, baseURL: string): Promise<string> {
  const cookies = await page.context().cookies(baseURL);
  return cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
}

function connectSocket(baseURL: string, cookieHeader: string, origin: string): Socket {
  return io(baseURL, {
    transports: ['websocket'],
    extraHeaders: { cookie: cookieHeader, origin },
  });
}

function onceConnected(socket: Socket, timeoutMs = 15000): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket did not connect.')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function expectConnectDenied(socket: Socket, timeoutMs = 15000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connect was not denied.')), timeoutMs);
    socket.once('connect_error', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      reject(new Error('Socket connected despite revoked session.'));
    });
  });
}

function onceSignal(
  socket: Socket,
  event: 'chat.message.created' | 'access.revoked',
  timeoutMs = 10000,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}.`)), timeoutMs);
    socket.once(event, (payload: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function noSignal(socket: Socket, event: string, waitMs = 3000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, waitMs);
    const onEvent = (): void => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      reject(new Error(`Unexpected ${event} signal arrived.`));
    };
    socket.on(event, onEvent);
  });
}

function settleJoins(waitMs = 6000): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

test.describe('chat socket: joins, isolation, revoke, resync', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision socket actors and join isolation rooms', async ({ page, browser }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatsocket');
    ctx.room405 = await findChatRoom(page, `E2E-${runId}-405`);
    ctx.room408 = await findChatRoom(page, `E2E-${runId}-408`);
    ctx.room415 = await findChatRoom(page, `E2E-${runId}-415`);
    ctx.room416 = await findChatRoom(page, `E2E-${runId}-416`);
    const sender = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtsoka');
    const receiver = await provisionActor(page, browser, baseURL, runId, testInfo.workerIndex, 'chtsokb');
    ctx.sender = sender;
    ctx.receiver = receiver;
    await joinRoom(page, ctx.room405 ?? '', sender.userId, 'SUB');
    await joinRoom(page, ctx.room405 ?? '', receiver.userId, 'SUB');
    await joinRoom(page, ctx.room408 ?? '', sender.userId, 'SUB');
    await joinRoom(page, ctx.room415 ?? '', sender.userId, 'SUB');
    await joinRoom(page, ctx.room416 ?? '', receiver.userId, 'SUB');
  });

  test('join allowed for current residents; http send and list work after join', async ({ page }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatsocket');
    const room405 = ctx.room405 ?? '';
    const sender = ctx.sender?.page;
    const receiver = ctx.receiver?.page;
    if (sender === undefined || receiver === undefined) throw new Error('Socket sessions are missing.');
    const senderCookie = await socketCookieHeader(sender, baseURL);
    const receiverCookie = await socketCookieHeader(receiver, baseURL);
    const senderSocket = connectSocket(baseURL, senderCookie, baseURL);
    const receiverSocket = connectSocket(baseURL, receiverCookie, baseURL);
    try {
      await Promise.all([onceConnected(senderSocket), onceConnected(receiverSocket)]);
      senderSocket.emit('room.join', { roomId: room405 });
      receiverSocket.emit('room.join', { roomId: room405 });
      await settleJoins();
      const sent = await postMessage(sender.request, room405, {
        clientMessageId: randomUUID(),
        text: 'Socket join probe.',
      });
      expect(sent.status).toBe(200);
      const listed = await listMessages(receiver.request, room405, '?limit=50');
      expect(listed.status).toBe(200);
      expect(asChatList(listed.json).data.map((entry) => entry.id)).toContain(
        asChatSend(sent.json).data.id,
      );
    } finally {
      senderSocket.disconnect();
      receiverSocket.disconnect();
    }
  });

  test(
    's-to-c chat.message.created is IDs-only with no body or url',
    async ({ page }) => {
      const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
      await loginAsPoolAdmin(page, 'chatsocket');
      const room405 = ctx.room405 ?? '';
      const sender = ctx.sender?.page;
      const receiver = ctx.receiver?.page;
      if (sender === undefined || receiver === undefined) throw new Error('Socket sessions are missing.');
      const senderCookie = await socketCookieHeader(sender, baseURL);
      const receiverCookie = await socketCookieHeader(receiver, baseURL);
      const senderSocket = connectSocket(baseURL, senderCookie, baseURL);
      const receiverSocket = connectSocket(baseURL, receiverCookie, baseURL);
      try {
        await Promise.all([onceConnected(senderSocket), onceConnected(receiverSocket)]);
        senderSocket.emit('room.join', { roomId: room405 });
        receiverSocket.emit('room.join', { roomId: room405 });
        await settleJoins();
        const created = onceSignal(receiverSocket, 'chat.message.created', 15000);
        const sent = await postMessage(sender.request, room405, {
          clientMessageId: randomUUID(),
          text: 'Socket signal probe.',
        });
        expect(sent.status).toBe(200);
        const signal = await created;
        expect(signal.roomId).toBe(room405);
        expect(signal.messageId).toBe(asChatSend(sent.json).data.id);
        expect('text' in signal).toBe(false);
        expect('body' in signal).toBe(false);
        expect('imageId' in signal).toBe(false);
        expect('url' in signal).toBe(false);
      } finally {
        senderSocket.disconnect();
        receiverSocket.disconnect();
      }
    },
  );

  test(
    'ms-chat-01: two browsers in distinct rooms observe only their own room',
    async ({ page }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatsocket');
    const room415 = ctx.room415 ?? '';
    const room416 = ctx.room416 ?? '';
    const sender = ctx.sender?.page;
    const receiver = ctx.receiver?.page;
    if (sender === undefined || receiver === undefined) throw new Error('Socket sessions are missing.');
    const senderCookie = await socketCookieHeader(sender, baseURL);
    const receiverCookie = await socketCookieHeader(receiver, baseURL);
    const socketA = connectSocket(baseURL, senderCookie, baseURL);
    const socketB = connectSocket(baseURL, receiverCookie, baseURL);
    try {
      await Promise.all([onceConnected(socketA), onceConnected(socketB)]);
      socketA.emit('room.join', { roomId: room415 });
      socketB.emit('room.join', { roomId: room416 });
      await settleJoins();
      const createdA = onceSignal(socketA, 'chat.message.created', 15000);
      const quietB = noSignal(socketB, 'chat.message.created', 3000);
      const sent = await postMessage(sender.request, room415, {
        clientMessageId: randomUUID(),
        text: 'Room 415 isolation probe.',
      });
      expect(sent.status).toBe(200);
      const signal = await createdA;
      expect(signal.roomId).toBe(room415);
      await quietB;
      const createdB = onceSignal(socketB, 'chat.message.created', 15000);
      const quietA = noSignal(socketA, 'chat.message.created', 3000);
      const sentB = await postMessage(receiver.request, room416, {
        clientMessageId: randomUUID(),
        text: 'Room 416 isolation probe.',
      });
      expect(sentB.status).toBe(200);
      const signalB = await createdB;
      expect(signalB.roomId).toBe(room416);
      await quietA;
    } finally {
      socketA.disconnect();
      socketB.disconnect();
    }
    },
  );

  test('spec 25.4.6 http half: ended membership denies send and list while other rooms work', async ({
    page,
  }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatsocket');
    const room405 = ctx.room405 ?? '';
    const room408 = ctx.room408 ?? '';
    const sender = ctx.sender?.page;
    if (sender === undefined) throw new Error('Socket session is missing.');
    const senderCookie = await socketCookieHeader(sender, baseURL);
    const senderSocket = connectSocket(baseURL, senderCookie, baseURL);
    try {
      await onceConnected(senderSocket);
      senderSocket.emit('room.join', { roomId: room405 });
      senderSocket.emit('room.join', { roomId: room408 });
      await settleJoins();
      const detail = await apiJson<{
        data: { memberships: Array<{ id: string; userId: string; endAt: string | null }> };
      }>(page.request, { method: 'GET', path: `/api/rooms/${room405}` });
      expect(detail.status).toBe(200);
      const membership = detail.json.data.memberships.find(
        (entry) => entry.userId === (ctx.sender?.userId ?? '') && entry.endAt === null,
      );
      if (membership === undefined) throw new Error('Sender has no open membership in 405.');
      const ended = await apiJson<{ data: { endAt: string | null } }>(page.request, {
        method: 'PATCH',
        path: `/api/rooms/${room405}/members/${membership.id}`,
        body: { action: 'END' },
      });
      expect(ended.status).toBe(200);
      const deniedSend = await postMessage(sender.request, room405, {
        clientMessageId: randomUUID(),
        text: 'Revoked sender note.',
      });
      expect(deniedSend.status).toBe(404);
      const deniedList = await listMessages(sender.request, room405);
      expect(deniedList.status).toBe(404);
      const stillWorks = await postMessage(sender.request, room408, {
        clientMessageId: randomUUID(),
        text: 'Other room still works.',
      });
      expect(stillWorks.status).toBe(200);
      const stillLists = await listMessages(sender.request, room408);
      expect(stillLists.status).toBe(200);
      expect(asChatList(stillLists.json).data.length).toBeGreaterThan(0);
    } finally {
      senderSocket.disconnect();
    }
  });

  test(
    'spec 25.4.6 signal half: membership END emits access.revoked to the room',
    async ({ page }) => {
      const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
      await loginAsPoolAdmin(page, 'chatsocket');
      const room408 = ctx.room408 ?? '';
      const sender = ctx.sender?.page;
      if (sender === undefined) throw new Error('Socket session is missing.');
      const senderCookie = await socketCookieHeader(sender, baseURL);
      const senderSocket = connectSocket(baseURL, senderCookie, baseURL);
      try {
        await onceConnected(senderSocket);
        senderSocket.emit('room.join', { roomId: room408 });
        await settleJoins();
        const revoked = onceSignal(senderSocket, 'access.revoked', 15000);
        const detail = await apiJson<{
          data: { memberships: Array<{ id: string; userId: string; endAt: string | null }> };
        }>(page.request, { method: 'GET', path: `/api/rooms/${room408}` });
        expect(detail.status).toBe(200);
        const membership = detail.json.data.memberships.find(
          (entry) => entry.userId === (ctx.sender?.userId ?? '') && entry.endAt === null,
        );
        if (membership === undefined) throw new Error('Sender has no open membership in 408.');
        const ended = await apiJson<{ data: { endAt: string | null } }>(page.request, {
          method: 'PATCH',
          path: `/api/rooms/${room408}/members/${membership.id}`,
          body: { action: 'END' },
        });
        expect(ended.status).toBe(200);
        const signal = await revoked;
        expect(signal.roomId).toBe(room408);
      } finally {
        senderSocket.disconnect();
      }
    },
  );

  test('ms-chat-02: reconnect resyncs missed messages over http with acl intact', async ({ page }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatsocket');
    const room408 = ctx.room408 ?? '';
    const sender = ctx.sender?.page;
    const receiver = ctx.receiver?.page;
    if (sender === undefined || receiver === undefined) throw new Error('Socket sessions are missing.');
    await joinRoom(page, room408, ctx.receiver?.userId ?? '', 'SUB');
    const reopen = await apiJson<{
      data: { memberships: Array<{ id: string; userId: string; endAt: string | null }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room408}` });
    expect(reopen.status).toBe(200);
    const senderOpen = reopen.json.data.memberships.some(
      (entry) => entry.userId === (ctx.sender?.userId ?? '') && entry.endAt === null,
    );
    if (!senderOpen) await joinRoom(page, room408, ctx.sender?.userId ?? '', 'SUB');
    const baseline = await listMessages(receiver.request, room408, '?limit=50');
    expect(baseline.status).toBe(200);
    const baselineRows = asChatList(baseline.json).data;
    const receiverCookie = await socketCookieHeader(receiver, baseURL);
    const receiverSocket = connectSocket(baseURL, receiverCookie, baseURL);
    try {
      await onceConnected(receiverSocket);
      receiverSocket.emit('room.join', { roomId: room408 });
      await settleJoins();
      receiverSocket.disconnect();
      const missed = await postMessage(sender.request, room408, {
        clientMessageId: randomUUID(),
        text: 'Missed while disconnected.',
      });
      expect(missed.status).toBe(200);
      const missedId = asChatSend(missed.json).data.id;
      const resyncSocket = connectSocket(baseURL, receiverCookie, baseURL);
      try {
        await onceConnected(resyncSocket);
        resyncSocket.emit('room.join', { roomId: room408 });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const anchor = baselineRows.length === 0 ? null : baselineRows[0];
        const query =
          anchor === null || anchor === undefined
            ? '?limit=50'
            : `?after=${encodeURIComponent(
                Buffer.from(JSON.stringify({ createdAt: anchor.createdAt, id: anchor.id }), 'utf8').toString(
                  'base64url',
                ),
              )}&limit=50`;
        const resynced = await listMessages(receiver.request, room408, query);
        expect(resynced.status).toBe(200);
        expect(asChatList(resynced.json).data.map((entry) => entry.id)).toContain(missedId);
      } finally {
        resyncSocket.disconnect();
      }
    } finally {
      if (receiverSocket.connected) receiverSocket.disconnect();
    }
  });

  test('handshake denies sockets with revoked sessions after suspend', async ({ page, browser }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'chatsocket');
    const { runId } = await readRunContext();
    const actor = await provisionActor(
      page,
      browser,
      baseURL,
      runId,
      0,
      'chtsokx',
    );
    try {
      const cookieHeader = await socketCookieHeader(actor.page, baseURL);
      const suspended = await apiJson<{ data: { userId: string } }>(page.request, {
        method: 'PATCH',
        path: `/api/admin/users/${actor.userId}/status`,
        body: { accountStatus: 'SUSPENDED' },
      });
      expect(suspended.status).toBe(200);
      const denied = connectSocket(baseURL, cookieHeader, baseURL);
      try {
        await expectConnectDenied(denied);
      } finally {
        denied.disconnect();
      }
      const revived = await apiJson<{ data: { userId: string } }>(page.request, {
        method: 'PATCH',
        path: `/api/admin/users/${actor.userId}/status`,
        body: { accountStatus: 'ACTIVE' },
      });
      expect(revived.status).toBe(200);
    } finally {
      await actor.close();
    }
  });

  test.afterAll(async () => {
    await ctx.sender?.close();
    await ctx.receiver?.close();
  });
});
