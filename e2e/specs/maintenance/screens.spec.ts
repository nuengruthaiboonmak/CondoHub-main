import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsAdmin, provisionUser } from '../../helpers/owner';
import { buildValidImage } from '../../helpers/announcementFiles';
import {
  findMaintenanceRoom,
  getEligibleRooms,
  getTicket,
  listTickets,
  patchTicket,
  postTicket,
  postTicketComment,
  type TicketCreateEnvelope,
  type TicketDetailEnvelope,
} from './maintenanceFlow';

function actorUsername(runId: string, workerIndex: number, stem: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `e2e${suffix}${stem}${workerIndex}`.slice(0, 30);
}

function actorPassword(runId: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `Msc-${suffix}-pw1`;
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

interface ActorSession {
  userId: string;
  username: string;
  page: Page;
}

interface ScreensCtx {
  reporter: ActorSession;
  owner: ActorSession;
  room304: string;
  room305: string;
  room306: string;
  photoPath: string;
  commonTicketId: string;
  privateTicketId: string;
  pmTicketId: string;
  terminalTicketId: string;
}

const ctx: Partial<ScreensCtx> = {};

test.describe('maintenance screens: create, comment, transition, terminal, admin inbox', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision reporter and owner, wire 304/305/306, seed open and terminal tickets', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room304 = await findMaintenanceRoom(page, `E2E-${runId}-304`);
    const room305 = await findMaintenanceRoom(page, `E2E-${runId}-305`);
    const room306 = await findMaintenanceRoom(page, `E2E-${runId}-306`);
    ctx.room304 = room304;
    ctx.room305 = room305;
    ctx.room306 = room306;
    const password = actorPassword(runId);

    async function provisionActor(stem: string): Promise<ActorSession> {
      const username = actorUsername(runId, testInfo.workerIndex, stem);
      const provisioned = await provisionUser(page, { username, name: `Screens ${stem} ${runId}` });
      const context = await browser.newContext({ baseURL });
      const userPage = await context.newPage();
      await completeFirstLogin(userPage, {
        username,
        tempPassword: provisioned.tempPassword,
        newPassword: password,
      });
      return { userId: provisioned.userId, username, page: userPage };
    }

    const reporter = await provisionActor('mntsscrn');
    const owner = await provisionActor('mntsscown');
    ctx.reporter = reporter;
    ctx.owner = owner;

    const owners305 = await apiJson<{ data: { owners: Array<{ userId: string }> } }>(page.request, {
      method: 'GET',
      path: `/api/rooms/${room305}`,
    });
    expect(owners305.status).toBe(200);
    expect(owners305.json.data.owners.length).toBeGreaterThan(0);
    const transferred = await apiJson<{ data: { endedOwnershipId: string } }>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${room305}/ownerships`,
      body: {
        action: 'TRANSFER',
        fromUserId: owners305.json.data.owners[0]?.userId ?? '',
        toUserId: owner.userId,
        effectiveAt: new Date().toISOString(),
      },
    });
    expect(transferred.status).toBe(200);

    for (const roomId of [room304, room305]) {
      const detail = await apiJson<{
        data: { tenancies: Array<{ id: string; state: string }> };
      }>(page.request, { method: 'GET', path: `/api/rooms/${roomId}` });
      expect(detail.status).toBe(200);
      const tenancy = detail.json.data.tenancies.find((entry) => entry.state === 'ACTIVE');
      if (tenancy === undefined) throw new Error('Room has no active tenancy.');
      const joined = await apiJson<{ data: { userId: string } }>(page.request, {
        method: 'POST',
        path: `/api/rooms/${roomId}/members`,
        body: { userId: reporter.userId, memberRole: 'SUB', tenancyId: tenancy.id },
      });
      expect(joined.status).toBe(200);
    }

    const detail306 = await apiJson<{
      data: { tenancies: Array<{ id: string; state: string; managementMode: string }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room306}` });
    expect(detail306.status).toBe(200);
    const tenancy306 = detail306.json.data.tenancies.find(
      (entry) => entry.state === 'ACTIVE' && entry.managementMode === 'PROJECT_MANAGED',
    );
    if (tenancy306 === undefined) throw new Error('Room 306 has no active PM tenancy.');
    const joinedPm = await apiJson<{ data: { userId: string } }>(page.request, {
      method: 'POST',
      path: `/api/rooms/${room306}/members`,
      body: { userId: reporter.userId, memberRole: 'SUB', tenancyId: tenancy306.id },
    });
    expect(joinedPm.status).toBe(200);

    const eligiblePrivate = await getEligibleRooms(reporter.page.request, 'PRIVATE_OWNER');
    expect(eligiblePrivate).toContain(room305);
    const eligiblePm = await getEligibleRooms(reporter.page.request, 'PROJECT_MANAGED_PRIVATE');
    expect(eligiblePm).toContain(room306);

    const ns = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const privateSeed = await postTicket(
      reporter.page.request,
      {
        routingKind: 'PRIVATE_OWNER',
        roomId: room305,
        locationDescription: `Screens seed kitchen ${ns}`,
        subject: `Screens seed leak ${ns}`,
        description: `Seeded private ticket for screens spec run ${runId}.`,
      },
      randomUUID(),
    );
    expect(privateSeed.status).toBe(200);
    ctx.privateTicketId = (privateSeed.json as TicketCreateEnvelope).data.id;

    const pmSeed = await postTicket(
      reporter.page.request,
      {
        routingKind: 'PROJECT_MANAGED_PRIVATE',
        roomId: room306,
        locationDescription: `Screens seed bedroom ${ns}`,
        subject: `Screens seed outlet ${ns}`,
        description: `Seeded managed ticket for screens spec run ${runId}.`,
      },
      randomUUID(),
    );
    expect(pmSeed.status).toBe(200);
    ctx.pmTicketId = (pmSeed.json as TicketCreateEnvelope).data.id;

    const terminalSeed = await postTicket(
      reporter.page.request,
      {
        routingKind: 'COMMON_AREA',
        locationDescription: `Screens seed lobby ${ns}`,
        subject: `Screens seed bulb ${ns}`,
        description: `Seeded terminal ticket for screens spec run ${runId}.`,
      },
      randomUUID(),
    );
    expect(terminalSeed.status).toBe(200);
    const terminalId = (terminalSeed.json as TicketCreateEnvelope).data.id;
    ctx.terminalTicketId = terminalId;
    const closed = await patchTicket(page.request, terminalId, {
      status: 'COMPLETED',
      expectedVersion: 1,
    });
    expect(closed.status).toBe(200);
    expect((closed.json as TicketDetailEnvelope).data.status).toBe('COMPLETED');

    ctx.photoPath = await writePhotoFixture('e2e-maintenance');
  });

  test('ui: reporter creates a common-area request live with one photo', async ({ page }) => {
    const reporter = ctx.reporter?.page ?? page;
    const { runId } = await readRunContext();
    const ns = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const subject = `Live lobby leak ui ${ns}`;
    await reporter.goto('/maintenance/new');
    await expect(reporter.getByTestId('maintenance-new-page')).toBeVisible();
    await expect(reporter.getByTestId('maintenance-create-room')).toHaveCount(0);
    await reporter.getByTestId('maintenance-create-location').fill(`Lobby near lift ui ${ns}`);
    await reporter.getByTestId('maintenance-create-subject').fill(subject);
    await reporter
      .getByTestId('maintenance-create-description')
      .fill(`Water pools near the lift after rain. Run ${runId}.`);
    await reporter
      .getByTestId('maintenance-create-upload-input')
      .setInputFiles(ctx.photoPath ?? '');
    await expect(reporter.getByTestId('maintenance-create-image-list')).toBeVisible();
    await reporter.getByTestId('maintenance-create-submit').click();
    await expect(reporter.getByTestId('maintenance-detail-page')).toBeVisible({ timeout: 15000 });
    await expect(reporter.getByTestId('maintenance-detail-title')).toHaveText(subject);
    await expect(reporter.getByTestId('maintenance-detail-kind')).toHaveCount(0);
    await expect(reporter.getByTestId('maintenance-detail-status')).toHaveText('Pending');
    const createdId = (await reporter.getByTestId('maintenance-detail-id').textContent()) ?? '';
    expect(createdId.trim()).not.toBe('');
    ctx.commonTicketId = createdId.trim();
    const detail = await getTicket(reporter.request, createdId.trim());
    expect(detail.roomId).toBeNull();
    expect(detail.images).toHaveLength(1);
    await reporter.goto('/maintenance');
    await expect(reporter.getByTestId(`maintenance-link-${createdId.trim()}`)).toBeVisible();
  });

  test('ui: reporter creates an owner-room request with the room picker', async ({ page }) => {
    const reporter = ctx.reporter?.page ?? page;
    const { runId } = await readRunContext();
    const ns = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const subject = `Live kitchen drip ui ${ns}`;
    await reporter.goto('/maintenance/new');
    await reporter.getByTestId('maintenance-create-kind-PRIVATE_OWNER').check();
    await expect(reporter.getByTestId('maintenance-create-room')).toBeVisible();
    await reporter.getByTestId('maintenance-create-room').selectOption(ctx.room305 ?? '');
    await reporter.getByTestId('maintenance-create-location').fill(`Kitchen sink ui ${ns}`);
    await reporter.getByTestId('maintenance-create-subject').fill(subject);
    await reporter
      .getByTestId('maintenance-create-description')
      .fill(`The kitchen tap drips all night. Run ${runId}.`);
    await reporter.getByTestId('maintenance-create-submit').click();
    await expect(reporter.getByTestId('maintenance-detail-page')).toBeVisible({ timeout: 15000 });
    await expect(reporter.getByTestId('maintenance-detail-title')).toHaveText(subject);
    await expect(reporter.getByTestId('maintenance-detail-kind')).toHaveCount(0);
    const createdId = (
      (await reporter.getByTestId('maintenance-detail-id').textContent()) ?? ''
    ).trim();
    expect(createdId).not.toBe('');
    const detail = await getTicket(reporter.request, createdId);
    expect(detail.roomId).toBe(ctx.room305 ?? '');
    await loginAsAdmin(page);
    await page.goto(`/admin/maintenance/${createdId}`);
    await expect(page.getByTestId('admin-maintenance-detail-missing')).toBeVisible();
  });

  test('ui: recipient comments live with a photo and sees old-to-new order', async ({ page }) => {
    const owner = ctx.owner?.page ?? page;
    const ticketId = ctx.privateTicketId ?? '';
    const { runId } = await readRunContext();
    const firstBody = `Owner first note screens ${runId}`;
    const seeded = await postTicketComment(
      owner.request,
      ticketId,
      { body: firstBody },
      randomUUID(),
    );
    expect(seeded.status).toBe(200);
    await owner.goto(`/maintenance/${ticketId}`);
    await expect(owner.getByTestId('maintenance-detail-page')).toBeVisible();
    await expect(owner.getByTestId('maintenance-detail-comments')).toContainText(firstBody);
    const secondBody = `Owner live note with photo ${runId}`;
    await owner.getByTestId('maintenance-detail-comment-body').fill(secondBody);
    await owner
      .getByTestId('maintenance-detail-comment-upload-input')
      .setInputFiles(ctx.photoPath ?? '');
    await expect(owner.getByTestId('maintenance-detail-comment-image-list')).toBeVisible();
    await owner.getByTestId('maintenance-detail-comment-submit').click();
    await expect(owner.getByTestId('maintenance-detail-comments')).toContainText(secondBody);
    const detail = await getTicket(owner.request, ticketId);
    expect(detail.comments.map((entry) => entry.body)).toEqual([firstBody, secondBody]);
    expect(detail.comments[1]?.images).toHaveLength(1);
  });

  test('ui: admin moves a common request live and the history shows the change', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const ticketId = ctx.commonTicketId ?? '';
    await page.goto(`/admin/maintenance/${ticketId}`);
    await expect(page.getByTestId('admin-maintenance-detail-page')).toBeVisible();
    await expect(page.getByTestId('admin-maintenance-detail-status')).toHaveText('Pending');
    await page.getByTestId('admin-maintenance-detail-transition-open').click();
    await page
      .getByTestId('admin-maintenance-detail-transition-status')
      .selectOption('IN_PROGRESS');
    await page.getByTestId('admin-maintenance-detail-transition-submit').click();
    await expect(page.getByTestId('admin-maintenance-detail-status')).toHaveText('In progress');
    await expect(page.getByTestId('admin-maintenance-detail-history')).toContainText(
      'Pending to In progress',
    );
    const detail = await getTicket(page.request, ticketId);
    expect(detail.status).toBe('IN_PROGRESS');
    expect(detail.version).toBe(2);
    const reporter = ctx.reporter?.page ?? page;
    await reporter.goto(`/maintenance/${ticketId}`);
    await expect(reporter.getByTestId('maintenance-detail-status')).toHaveText('In progress');
  });

  test('ui: validation alerts mark invalid fields, focus first, keyboard submit works', async ({
    page,
  }) => {
    const reporter = ctx.reporter?.page ?? page;
    await reporter.goto('/maintenance/new');
    await expect(reporter.getByTestId('maintenance-new-page')).toBeVisible();
    await reporter.getByTestId('maintenance-create-kind-PRIVATE_OWNER').check();
    await expect(reporter.getByTestId('maintenance-create-room')).toBeVisible();
    await reporter.getByTestId('maintenance-create-submit').click();
    await expect(reporter.getByTestId('maintenance-create-room-error')).toBeVisible();
    await expect(reporter.getByTestId('maintenance-create-room')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(reporter.getByTestId('maintenance-create-room')).toBeFocused();
    await expect(reporter.getByTestId('maintenance-create-location-error')).toBeVisible();
    await expect(reporter.getByTestId('maintenance-create-location')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const { runId } = await readRunContext();
    const ns = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await reporter.getByTestId('maintenance-create-room').selectOption(ctx.room305 ?? '');
    await reporter.getByTestId('maintenance-create-location').fill(`Validation hall ui ${ns}`);
    await reporter.getByTestId('maintenance-create-subject').fill(`Validation subject ui ${ns}`);
    await reporter
      .getByTestId('maintenance-create-description')
      .fill(`Keyboard submit check run ${runId}.`);
    await reporter.getByTestId('maintenance-create-submit').focus();
    await reporter.keyboard.press('Enter');
    await expect(reporter.getByTestId('maintenance-detail-page')).toBeVisible({ timeout: 15000 });
    await expect(reporter.getByTestId('maintenance-detail-kind')).toHaveCount(0);
  });

  test('ui: terminal request renders read-only with no comment or transition forms', async ({
    page,
  }) => {
    const reporter = ctx.reporter?.page ?? page;
    const ticketId = ctx.terminalTicketId ?? '';
    await reporter.goto(`/maintenance/${ticketId}`);
    await expect(reporter.getByTestId('maintenance-detail-page')).toBeVisible();
    await expect(reporter.getByTestId('maintenance-detail-status')).toHaveText('Completed');
    await expect(reporter.getByTestId('maintenance-detail-terminal-note')).toBeVisible();
    await expect(reporter.getByTestId('maintenance-detail-comment-form')).toHaveCount(0);
    await expect(reporter.getByTestId('maintenance-detail-transition-form')).toHaveCount(0);
    await reporter.goto('/maintenance');
    await reporter.getByTestId('maintenance-view-history').click();
    await expect(reporter.getByTestId('maintenance-history-list')).toContainText(
      'Screens seed bulb',
    );
    await loginAsAdmin(page);
    await page.goto(`/admin/maintenance/${ticketId}`);
    await expect(page.getByTestId('admin-maintenance-detail-terminal-note')).toBeVisible();
    await expect(page.getByTestId('admin-maintenance-detail-comment-form')).toHaveCount(0);
    await expect(page.getByTestId('admin-maintenance-detail-transition-form')).toHaveCount(0);
  });

  test('ui: admin inbox excludes owner-room rows and splits open from history', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/maintenance');
    await expect(page.getByTestId('admin-maintenance-page')).toBeVisible();
    const inbox = await listTickets(page.request, { page: 1, pageSize: 100 });
    for (const row of inbox.rows) {
      expect(row.routingKind).not.toBe('PRIVATE_OWNER');
    }
    const privateRow = page.getByTestId(`admin-maintenance-row-${ctx.privateTicketId ?? ''}`);
    await expect(privateRow).toHaveCount(0);
    await expect(
      page.getByTestId(`admin-maintenance-row-${ctx.commonTicketId ?? ''}`),
    ).toBeVisible();
    await expect(page.getByTestId(`admin-maintenance-row-${ctx.pmTicketId ?? ''}`)).toBeVisible();
    await expect(
      page.getByTestId(`admin-maintenance-row-${ctx.terminalTicketId ?? ''}`),
    ).toHaveCount(0);
    await page.getByTestId('admin-maintenance-view-history').click();
    await expect(
      page.getByTestId(`admin-maintenance-row-${ctx.terminalTicketId ?? ''}`),
    ).toBeVisible();
    await page.getByTestId('admin-maintenance-view-open').click();
    const kinds = await page.getByTestId('admin-maintenance-open-list').textContent();
    expect(kinds ?? '').not.toContain('Owner room');
    const reporter = ctx.reporter?.page ?? page;
    await reporter.goto('/maintenance');
    await expect(reporter.getByTestId('maintenance-open-list')).toBeVisible();
    await expect(
      reporter.getByTestId(`maintenance-link-${ctx.privateTicketId ?? ''}`),
    ).toBeVisible();
  });

  test('ui: reporter cancels a waiting request and the server deny copy stays generic', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const ticketId = ctx.pmTicketId ?? '';
    const detail = await getTicket(page.request, ticketId);
    const waiting = await patchTicket(page.request, ticketId, {
      status: 'WAITING_FOR_INFO',
      expectedVersion: detail.version,
    });
    expect(waiting.status).toBe(200);
    const reporter = ctx.reporter?.page ?? page;
    await reporter.goto(`/maintenance/${ticketId}`);
    await expect(reporter.getByTestId('maintenance-detail-page')).toBeVisible();
    await expect(reporter.getByTestId('maintenance-detail-status')).toHaveText('Waiting for info');
    await reporter.getByTestId('maintenance-detail-transition-open').click();
    await reporter.getByTestId('maintenance-detail-transition-submit').click();
    await expect(reporter.getByTestId('maintenance-detail-status')).toHaveText('Cancelled');
    const unknownId = '00000000-0000-4000-8000-000000000000';
    await reporter.goto(`/maintenance/${unknownId}`);
    await expect(reporter.getByTestId('maintenance-detail-missing')).toContainText(
      'does not exist or you do not have access',
    );
  });
});
