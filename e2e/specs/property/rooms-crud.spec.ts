import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import {
  completeFirstLogin,
  loginAsAdmin,
  provisionUser,
  uniqueUsername,
  roomOwnerAt,
  transferRoomTo,
} from '../../helpers/owner';

interface RoomEnvelope {
  data: Array<{ id: string; roomCode: string; status: string }>;
  meta: { page: number; pageSize: number; total: number };
}

interface RoomDetail {
  data: {
    id: string;
    roomCode: string;
    owners: Array<{ userId: string; ownershipId: string }>;
    memberships: Array<{ id: string; userId: string; memberRole: string; endAt: string | null }>;
    tenancies: Array<{ id: string; state: string; managementMode: string }>;
  };
}

test.describe('property rooms: list, detail, and scoping', () => {
  test.setTimeout(120000);
  test('admin lists rooms and opens seeded room detail', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);

    const listed = await apiJson<RoomEnvelope>(page.request, {
      method: 'GET',
      path: `/api/rooms?pageSize=100&query=${encodeURIComponent(`E2E-${runId}-`)}`,
    });
    expect(listed.status).toBe(200);
    expect(listed.json.meta.total).toBeGreaterThanOrEqual(5);
    const room101 = listed.json.data.find((room) => room.roomCode === `E2E-${runId}-101`);
    expect(room101).toBeDefined();

    const detail = await apiJson<RoomDetail>(page.request, {
      method: 'GET',
      path: `/api/rooms/${room101?.id}`,
    });
    expect(detail.status).toBe(200);
    expect(detail.json.data.owners.length).toBeGreaterThanOrEqual(2);
    expect(detail.json.data.tenancies.some((tenancy) => tenancy.state === 'ACTIVE')).toBe(true);

    await page.goto(`/rooms/${room101?.id}`);
    await expect(page.getByTestId('room-detail-title')).toContainText(`E2E-${runId}-101`);
    await expect(page.getByTestId('room-owners-list')).toBeVisible();
  });

  test('resident sees only entitled rooms', async ({ page }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await loginAsAdmin(page);

    const listed = await apiJson<RoomEnvelope>(page.request, {
      method: 'GET',
      path: `/api/rooms?pageSize=100&query=${encodeURIComponent(`E2E-${runId}-`)}`,
    });
    const room105 = listed.json.data.find((room) => room.roomCode === `E2E-${runId}-105`);
    expect(room105).toBeDefined();

    const username = uniqueUsername(`e2e${suffix}viewer`);
    const viewer = await provisionUser(page, { username, name: `Viewer ${ns}` });
    const fromOwner = await roomOwnerAt(page, room105?.id ?? '');
    await transferRoomTo(page, {
      roomId: room105?.id ?? '',
      fromUserId: fromOwner,
      toUserId: viewer.userId,
    });
    const password = `Viewer-${suffix}-pw1`;
    await completeFirstLogin(page, {
      username,
      tempPassword: viewer.tempPassword,
      newPassword: password,
    });

    const mine = await apiJson<RoomEnvelope>(page.request, {
      method: 'GET',
      path: `/api/rooms?pageSize=100&query=${encodeURIComponent(`E2E-${runId}-`)}`,
    });
    expect(mine.status).toBe(200);
    expect(mine.json.data.some((room) => room.id === room105?.id)).toBe(true);

    await page.goto('/rooms');
    await expect(page.getByTestId('my-rooms-page')).toBeVisible();
    await expect(page.getByTestId('my-rooms-list')).toBeVisible();
  });

  test('unknown room returns 404 concealment', async ({ page }) => {
    await loginAsAdmin(page);
    const missing = await apiJson<unknown>(page.request, {
      method: 'GET',
      path: '/api/rooms/00000000-0000-4000-8000-000000000000',
    });
    expect(missing.status).toBe(404);
  });
});
