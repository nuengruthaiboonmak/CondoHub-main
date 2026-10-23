import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import {
  completeFirstLogin,
  loginAsAdmin,
  loginAsUser,
  provisionUser,
  uniqueUsername,
} from '../../helpers/owner';

interface IdEnvelope {
  data: { id: string };
}

interface OwnershipEnvelope {
  data: { ownershipId: string; userId: string; startAt: string; tempPassword?: string };
}

interface TenancyEnvelope {
  data: {
    id: string;
    roomId: string;
    startsAt: string;
    endsAt: string | null;
    state: string;
    managementMode: string;
  };
}

interface RoomDetail {
  data: {
    owners: Array<{ userId: string }>;
    tenancies: Array<{ id: string; state: string }>;
  };
}

async function createRoomFixture(
  request: Parameters<typeof apiJson>[0],
  ns: string,
  projectId: string,
): Promise<{ buildingId: string; floorId: string; roomId: string }> {
  const building = await apiJson<IdEnvelope>(request, {
    method: 'POST',
    path: '/api/admin/buildings',
    body: { projectId, code: `${ns}-B1`, name: `${ns} Tower`, status: 'ACTIVE' },
  });
  expect(building.status).toBe(200);
  const floor = await apiJson<IdEnvelope>(request, {
    method: 'POST',
    path: '/api/admin/floors',
    body: { buildingId: building.json.data.id, code: `${ns}-F1`, label: `${ns} Floor 1` },
  });
  expect(floor.status).toBe(200);
  const room = await apiJson<IdEnvelope>(request, {
    method: 'POST',
    path: '/api/admin/rooms',
    body: {
      floorId: floor.json.data.id,
      buildingId: building.json.data.id,
      roomCode: `${ns}-R101`,
      areaSqm: '45.5',
      status: 'ACTIVE',
    },
  });
  expect(room.status).toBe(200);
  return {
    buildingId: building.json.data.id,
    floorId: floor.json.data.id,
    roomId: room.json.data.id,
  };
}

test.describe('property ownership: assign first owner', () => {
  test.setTimeout(120000);

  test('admin assigns first and additional owners', async ({ page }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await loginAsAdmin(page);
    const projectId = randomUUID();
    const tag = `E2E-${runId}-TA`;
    const { roomId } = await createRoomFixture(page.request, tag, projectId);

    const ownerA = uniqueUsername(`e2e${suffix}owna`);
    const targetA = await provisionUser(page, { username: ownerA, name: `Owner A ${ns}` });

    const assigned = await apiJson<OwnershipEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/owners`,
      body: { username: ownerA },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.json.data.userId).toBe(targetA.userId);

    const detail = await apiJson<RoomDetail>(page.request, {
      method: 'GET',
      path: `/api/rooms/${roomId}`,
    });
    expect(detail.status).toBe(200);
    expect(detail.json.data.owners.some((owner) => owner.userId === targetA.userId)).toBe(true);

    const duplicate = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/owners`,
      body: { username: ownerA },
    });
    expect(duplicate.status).toBe(400);

    const unknown = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/owners`,
      body: { username: `nobody-${suffix}` },
    });
    expect(unknown.status).toBe(400);

    const ownerB = uniqueUsername(`e2e${suffix}ownb`);
    const targetB = await provisionUser(page, { username: ownerB, name: `Owner B ${ns}` });
    const second = await apiJson<OwnershipEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/owners`,
      body: { userId: targetB.userId },
    });
    expect(second.status).toBe(200);

    const missingRoom = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: '/api/admin/rooms/00000000-0000-0000-0000-000000000000/owners',
      body: { username: ownerA },
    });
    expect(missingRoom.status).toBe(404);
  });

  test('assign provisions a new user and honors idempotency', async ({ page }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await loginAsAdmin(page);
    const projectId = randomUUID();
    const tag = `E2E-${runId}-TB`;
    const { roomId } = await createRoomFixture(page.request, tag, projectId);

    const fresh = uniqueUsername(`e2e${suffix}fresh`);
    const key = randomUUID();
    const provisioned = await apiJson<OwnershipEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/owners`,
      body: {
        username: fresh,
        email: `${fresh}@example.invalid`,
        name: `Fresh Owner ${ns}`,
      },
      headers: { 'Idempotency-Key': key },
    });
    expect(provisioned.status).toBe(200);
    expect(typeof provisioned.json.data.tempPassword).toBe('string');
    const ownershipId = provisioned.json.data.ownershipId;

    const replay = await apiJson<OwnershipEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/owners`,
      body: {
        username: fresh,
        email: `${fresh}@example.invalid`,
        name: `Fresh Owner ${ns}`,
      },
      headers: { 'Idempotency-Key': key },
    });
    expect(replay.status).toBe(200);
    expect(replay.json.data.ownershipId).toBe(ownershipId);

    const conflict = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/owners`,
      body: { username: uniqueUsername(`e2e${suffix}other`) },
      headers: { 'Idempotency-Key': key },
    });
    expect(conflict.status).toBe(400);
  });
});

test.describe('property tenancy: create and end', () => {
  test.setTimeout(120000);

  test('owner and admin manage tenancies with permission checks', async ({ page }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await loginAsAdmin(page);
    const projectId = randomUUID();
    const tag = `E2E-${runId}-TC`;
    const { roomId } = await createRoomFixture(page.request, tag, projectId);

    const ownerName = uniqueUsername(`e2e${suffix}town`);
    const owner = await provisionUser(page, { username: ownerName, name: `Tenancy Owner ${ns}` });
    const assigned = await apiJson<OwnershipEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/owners`,
      body: { userId: owner.userId },
    });
    expect(assigned.status).toBe(200);

    const ownerPassword = `Owner-${suffix}-pw1`;
    const outsiderName = uniqueUsername(`e2e${suffix}tout`);
    const outsider = await provisionUser(page, { username: outsiderName, name: `Outsider ${ns}` });
    const outsiderPassword = `Outsider-${suffix}-pw1`;
    await completeFirstLogin(page, {
      username: ownerName,
      tempPassword: owner.tempPassword,
      newPassword: ownerPassword,
    });
    await loginAsUser(page, ownerName, ownerPassword);

    const startsAt = new Date().toISOString();
    const created = await apiJson<TenancyEnvelope>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/tenancies`,
      body: { startsAt, managementMode: 'PRIVATE_OWNER_MANAGED' },
    });
    expect(created.status).toBe(200);
    expect(created.json.data.state).toBe('ACTIVE');
    const tenancyId = created.json.data.id;

    const overlapping = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/tenancies`,
      body: { startsAt, managementMode: 'PRIVATE_OWNER_MANAGED' },
    });
    expect(overlapping.status).toBe(400);

    const projectManaged = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/tenancies`,
      body: { startsAt, managementMode: 'PROJECT_MANAGED' },
    });
    expect(projectManaged.status).toBe(403);

    await completeFirstLogin(page, {
      username: outsiderName,
      tempPassword: outsider.tempPassword,
      newPassword: outsiderPassword,
    });
    await loginAsUser(page, outsiderName, outsiderPassword);
    const forbidden = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: `/api/rooms/${roomId}/tenancies`,
      body: { startsAt, managementMode: 'PRIVATE_OWNER_MANAGED' },
    });
    expect(forbidden.status).toBe(403);

    await loginAsUser(page, ownerName, ownerPassword);
    const ended = await apiJson<TenancyEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/rooms/${roomId}/tenancies/${tenancyId}`,
      body: { action: 'END' },
    });
    expect(ended.status).toBe(200);
    expect(ended.json.data.state).toBe('ENDED');

    const endedAgain = await apiJson<unknown>(page.request, {
      method: 'PATCH',
      path: `/api/rooms/${roomId}/tenancies/${tenancyId}`,
      body: { action: 'END' },
    });
    expect(endedAgain.status).toBe(400);

    const otherRoom = await apiJson<unknown>(page.request, {
      method: 'PATCH',
      path: `/api/rooms/00000000-0000-0000-0000-000000000000/tenancies/${tenancyId}`,
      body: { action: 'END' },
    });
    expect(otherRoom.status).toBe(404);
  });

  test('admin and owner manage tenancies through the UI', async ({ page }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await loginAsAdmin(page);
    const projectId = randomUUID();
    const tag = `E2E-${runId}-TD`;
    const { roomId } = await createRoomFixture(page.request, tag, projectId);

    await page.goto(`/admin/ownership?roomId=${roomId}`);
    await expect(page.getByTestId('room-detail-page')).toBeVisible();
    await expect(page.getByTestId('room-owners-empty')).toBeVisible();

    const uiOwner = uniqueUsername(`e2e${suffix}uiown`);
    const uiTarget = await provisionUser(page, { username: uiOwner, name: `UI Owner ${ns}` });
    await page.getByTestId('ownership-assign-open').click();
    await page.getByTestId('ownership-assign-username').fill(uiOwner);
    await page.getByTestId('ownership-assign-submit').click();
    await expect(page.getByTestId('room-owners-list')).toContainText(`UI Owner ${ns}`);

    const start = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await page.getByTestId('room-rental-link').click();
    await page.getByTestId('room-tenancy-create-open').click();
    await page.getByTestId('room-tenancy-create-start').fill(start);
    await page.getByTestId('room-tenancy-create-mode').selectOption('PROJECT_MANAGED');
    await page.getByTestId('room-tenancy-create-submit').click();
    await expect(page.getByRole('region', { name: 'Selected rental' })).toContainText(
      'Project managed',
    );
    await page.getByTestId('rental-period-details').locator('summary').click();
    const endButton = page.getByTestId(/^room-tenancy-end-/).first();
    const endTestId = (await endButton.getAttribute('data-testid')) ?? '';
    expect(endTestId).toMatch(/^room-tenancy-end-[0-9a-f-]{36}$/);
    await endButton.click();
    await page.getByTestId('room-tenancy-end-submit').click();
    await expect(page.getByRole('region', { name: 'Selected rental' })).toContainText('Ended');

    const ownerPassword = `Uiowner-${suffix}-pw1`;
    await completeFirstLogin(page, {
      username: uiOwner,
      tempPassword: uiTarget.tempPassword,
      newPassword: ownerPassword,
    });
    await loginAsUser(page, uiOwner, ownerPassword);
    await page.goto(`/rooms/${roomId}`);
    await expect(page.getByTestId('room-detail-page')).toBeVisible();
    await page.getByTestId('room-rental-link').click();
    await page.getByTestId('room-tenancy-create-open').click();
    await expect(page.getByTestId('room-tenancy-create-form')).toBeVisible();
    const residentStart = new Date().toISOString().slice(0, 10);
    await page.getByTestId('room-tenancy-create-start').fill(residentStart);
    await page.getByTestId('room-tenancy-create-submit').click();

    await loginAsAdmin(page);
    await page.goto(`/admin/ownership?roomId=${roomId}`);
    await page.getByTestId('room-rental-link').click();
    await expect(page.getByRole('region', { name: 'Selected rental' })).toContainText(
      'Owner managed',
    );

    await page.goto(`/rooms/${roomId}`);
    await expect(page.getByTestId('room-detail-page')).toBeVisible();
    await page.getByTestId('room-rental-link').click();
    await page.getByTestId('rental-period-details').locator('summary').click();
    const residentEnd = page.getByTestId(/^room-tenancy-end-/).first();
    await residentEnd.click();
    await page.getByTestId('room-tenancy-end-submit').click();
    await expect(page.getByRole('region', { name: 'Selected rental' })).toContainText('Ended');
  });
});
