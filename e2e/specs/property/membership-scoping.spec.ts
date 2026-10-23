import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import { loginAsAdmin, provisionUser, uniqueUsername } from '../../helpers/owner';

interface RoomList {
  data: Array<{ id: string; roomCode: string }>;
  meta: { total: number };
}

interface MemberResult {
  data: { id: string; userId: string; memberRole: string };
}

test.describe('property membership: add, end, re-add, and overlap reject', () => {
  test.setTimeout(120000);
  test('admin adds and ends a membership; re-add creates a new interval', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await loginAsAdmin(page);

    const listed = await apiJson<RoomList>(page.request, {
      method: 'GET',
      path: `/api/rooms?pageSize=100&query=${encodeURIComponent(`E2E-${runId}-`)}`,
    });
    expect(listed.status).toBe(200);
    const room102 = listed.json.data.find((room) => room.roomCode === `E2E-${runId}-102`);
    expect(room102).toBeDefined();
    const roomId = room102?.id ?? '';

    const memberUsername = uniqueUsername(`e2e${suffix}member`);
    const member = await provisionUser(page, {
      username: memberUsername,
      name: `Member Target ${ns}`,
    });

    const detail = await apiJson<{ data: { tenancies: Array<{ id: string; state: string }> } }>(
      page.request,
      {
        method: 'GET',
        path: `/api/rooms/${roomId}`,
      },
    );
    const activeTenancy = detail.json.data.tenancies.find((tenancy) => tenancy.state === 'ACTIVE');
    expect(activeTenancy).toBeDefined();

    const added = await apiJson<MemberResult>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/members`,
      body: { userId: member.userId, memberRole: 'SUB', tenancyId: activeTenancy?.id },
    });
    expect(added.status).toBe(200);
    expect(added.json.data.memberRole).toBe('SUB');
    await page.goto(`/rooms/${roomId}`);
    await expect(
      page.getByTestId('room-memberships-list').getByText(`Member Target ${ns}`, { exact: true }),
    ).toHaveCount(1);

    const overlapping = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/members`,
      body: { userId: member.userId, memberRole: 'SUB', tenancyId: activeTenancy?.id },
    });
    expect(overlapping.status).toBe(400);

    const ended = await apiJson<{ data: { id: string; endAt: string | null } }>(page.request, {
      method: 'PATCH',
      path: `/api/rooms/${roomId}/members/${added.json.data.id}`,
      body: { action: 'END' },
    });
    expect(ended.status).toBe(200);
    expect(ended.json.data.endAt).not.toBeNull();
    await page.reload();
    await expect(page.getByText(`Member Target ${ns}`, { exact: true })).toHaveCount(0);

    const readded = await apiJson<MemberResult>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/members`,
      body: { userId: member.userId, memberRole: 'SUB', tenancyId: activeTenancy?.id },
    });
    expect(readded.status).toBe(200);
    expect(readded.json.data.id).not.toBe(added.json.data.id);
    await page.reload();
    await expect(
      page.getByTestId('room-memberships-list').getByText(`Member Target ${ns}`, { exact: true }),
    ).toHaveCount(1);
  });

  test('direct membership without tenancy is rejected during active tenancy', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await loginAsAdmin(page);

    const listed = await apiJson<RoomList>(page.request, {
      method: 'GET',
      path: `/api/rooms?pageSize=100&query=${encodeURIComponent(`E2E-${runId}-`)}`,
    });
    const room102 = listed.json.data.find((room) => room.roomCode === `E2E-${runId}-102`);
    const roomId = room102?.id ?? '';

    const memberUsername = uniqueUsername(`e2e${suffix}direct`);
    const member = await provisionUser(page, {
      username: memberUsername,
      name: `Direct Target ${ns}`,
    });

    const direct = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/members`,
      body: { userId: member.userId, memberRole: 'SUB' },
    });
    expect(direct.status).toBe(400);
  });
});
