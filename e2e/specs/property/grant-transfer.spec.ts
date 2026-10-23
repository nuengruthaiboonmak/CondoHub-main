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

interface RoomList {
  data: Array<{ id: string; roomCode: string }>;
}

interface GrantResult {
  data: { ownershipId: string; userId: string; startAt: string; tempPassword?: string };
}

test.describe('property ownership: grant and transfer', () => {
  test.setTimeout(120000);
  test('owner grants co-owner, admin transfers ownership', async ({ page }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await loginAsAdmin(page);

    const listed = await apiJson<RoomList>(page.request, {
      method: 'GET',
      path: `/api/rooms?pageSize=100&query=${encodeURIComponent(`E2E-${runId}-`)}`,
    });
    expect(listed.status).toBe(200);
    const room103 = listed.json.data.find((room) => room.roomCode === `E2E-${runId}-103`);
    expect(room103).toBeDefined();
    const roomId = room103?.id ?? '';

    const grantUsername = uniqueUsername(`e2e${suffix}grant`);
    const grantTarget = await provisionUser(page, {
      username: grantUsername,
      name: `Grant Target ${ns}`,
    });
    const currentOwner = await roomOwnerAt(page, roomId);
    await transferRoomTo(page, { roomId, fromUserId: currentOwner, toUserId: grantTarget.userId });

    const afterTransfer = await apiJson<{ data: { owners: Array<{ userId: string }> } }>(
      page.request,
      {
        method: 'GET',
        path: `/api/rooms/${roomId}`,
      },
    );
    expect(
      afterTransfer.json.data.owners.some((owner) => owner.userId === grantTarget.userId),
    ).toBe(true);

    const badTransfer = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/ownerships`,
      body: {
        action: 'TRANSFER',
        fromUserId: '00000000-0000-0000-0000-000000000000',
        toUserId: grantTarget.userId,
        effectiveAt: new Date().toISOString(),
      },
    });
    expect(badTransfer.status).toBe(400);

    const coUsername = uniqueUsername(`e2e${suffix}coown`);
    const coTarget = await provisionUser(page, {
      username: coUsername,
      name: `Coowner Target ${ns}`,
    });

    const ownerPassword = `Owner-${suffix}-pw1`;
    await completeFirstLogin(page, {
      username: grantUsername,
      tempPassword: grantTarget.tempPassword,
      newPassword: ownerPassword,
    });

    const granted = await apiJson<GrantResult>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/co-owners`,
      body: { username: coUsername },
    });
    expect(granted.status).toBe(200);
    expect(granted.json.data.tempPassword).toBeUndefined();

    const regrant = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/co-owners`,
      body: { userId: coTarget.userId },
    });
    expect(regrant.status).toBe(400);
  });
});
