import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsAdmin } from '../../helpers/owner';

interface BuildingEnvelope {
  data: { id: string; code: string; name: string; status: string };
}

interface FloorEnvelope {
  data: { id: string; code: string; label: string };
}

interface RoomEnvelope {
  data: { id: string; roomCode: string; areaSqm: string; status: string };
}

interface DisableEnvelope {
  data: {
    room: { id: string; status: string };
    impact: {
      activeTenancies: number;
      activeMemberships: number;
      ownershipIntervals: number;
    };
  };
}

test.describe('property structures: buildings, floors, rooms manage', () => {
  test.setTimeout(120000);

  test('admin creates, edits, deactivates, and removes structures', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const ns = `E2E-${runId}-SM`;
    const buildingCode = `${ns}-B1`;
    const projectId = randomUUID();

    const created = await apiJson<BuildingEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/buildings',
      body: { projectId, code: buildingCode, name: `${ns} Tower`, status: 'ACTIVE' },
    });
    expect(created.status).toBe(200);
    const buildingId = created.json.data.id;

    const duplicate = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: '/api/admin/buildings',
      body: { projectId, code: buildingCode, name: `${ns} Tower`, status: 'ACTIVE' },
    });
    expect(duplicate.status).toBe(400);

    const buildingMissing = await apiJson<unknown>(page.request, {
      method: 'PATCH',
      path: '/api/admin/buildings/00000000-0000-0000-0000-000000000000',
      body: { status: 'INACTIVE' },
    });
    expect(buildingMissing.status).toBe(404);

    const floor = await apiJson<FloorEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/floors',
      body: { buildingId, code: `${ns}-F1`, label: `${ns} Floor 1` },
    });
    expect(floor.status).toBe(200);
    const floorId = floor.json.data.id;

    const floorPatched = await apiJson<FloorEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/floors/${floorId}`,
      body: { label: `${ns} Floor One` },
    });
    expect(floorPatched.status).toBe(200);
    expect(floorPatched.json.data.label).toBe(`${ns} Floor One`);

    const floorEmpty = await apiJson<unknown>(page.request, {
      method: 'PATCH',
      path: `/api/admin/floors/${floorId}`,
      body: {},
    });
    expect(floorEmpty.status).toBe(400);

    const room = await apiJson<RoomEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/rooms',
      body: {
        floorId,
        buildingId,
        roomCode: `${ns}-R101`,
        areaSqm: '45.5',
        status: 'ACTIVE',
      },
    });
    expect(room.status).toBe(200);
    const roomId = room.json.data.id;

    const roomPatched = await apiJson<RoomEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/rooms/${roomId}`,
      body: { areaSqm: '46.25' },
    });
    expect(roomPatched.status).toBe(200);
    expect(roomPatched.json.data.areaSqm).toBe('46.25');

    const roomEmpty = await apiJson<unknown>(page.request, {
      method: 'PATCH',
      path: `/api/admin/rooms/${roomId}`,
      body: {},
    });
    expect(roomEmpty.status).toBe(400);

    const blockedDelete = await page.request.delete(`/api/admin/floors/${floorId}`);
    expect(blockedDelete.status()).toBe(400);

    const disabled = await apiJson<DisableEnvelope>(page.request, {
      method: 'POST',
      path: `/api/admin/rooms/${roomId}/disable`,
    });
    expect(disabled.status).toBe(200);
    expect(disabled.json.data.room.status).toBe('INACTIVE');
    expect(disabled.json.data.impact.activeTenancies).toBe(0);

    const emptyFloor = await apiJson<FloorEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/floors',
      body: { buildingId, code: `${ns}-F9`, label: `${ns} Empty` },
    });
    expect(emptyFloor.status).toBe(200);
    const removed = await page.request.delete(`/api/admin/floors/${emptyFloor.json.data.id}`);
    expect(removed.status()).toBe(200);

    const deactivated = await apiJson<BuildingEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/buildings/${buildingId}`,
      body: { status: 'INACTIVE' },
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.json.data.status).toBe('INACTIVE');

    const reactivated = await apiJson<BuildingEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/buildings/${buildingId}`,
      body: { status: 'ACTIVE' },
    });
    expect(reactivated.status).toBe(200);
    expect(reactivated.json.data.status).toBe('ACTIVE');

    await expect(async () => {
      const missing = await page.request.delete(`/api/admin/floors/${buildingId}`);
      expect(missing.status()).toBe(404);
    }).toPass();

    await page.goto(`/admin/buildings/${buildingId}`);
    await expect(page.getByTestId('admin-building-detail-page')).toBeVisible();
    await expect(page.getByTestId('admin-floors-list')).toContainText(`${ns} Floor One`);
    await expect(page.getByTestId('admin-rooms-list')).toContainText(`${ns}-R101`);
  });

  test('admin creates a building through the UI', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const ns = `E2E-${runId}-SMUI`;
    const name = `${ns} Tower`;

    await page.goto('/admin/buildings');
    await page.getByTestId('admin-buildings-create').click();
    await expect(page.getByTestId('building-create-form')).toBeVisible();
    await page.getByTestId('building-create-name').fill(name);
    await page.getByTestId('building-create-submit').click();
    await expect(page).toHaveURL(/\/admin\/buildings\?query=/, { timeout: 15000 });
    await expect(page.getByTestId('admin-buildings-list')).toContainText(name);

    const row = page.getByTestId(new RegExp(`^admin-buildings-row-`)).filter({ hasText: name });
    const rowTestId = (await row.first().getAttribute('data-testid')) ?? '';
    const uiBuildingId = rowTestId.replace('admin-buildings-row-', '');

    await row.first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/buildings/${uiBuildingId}`));
    await page.getByTestId('building-actions-trigger').click();
    await page.getByTestId('building-deactivate-open').click();
    await page.getByTestId('building-deactivate-submit').click();
    await expect(page.getByText('Inactive').first()).toBeVisible({ timeout: 15000 });

    await page.getByTestId('building-actions-trigger').click();
    await page.getByTestId('building-reactivate-open').click();
    await page.getByTestId('building-reactivate-submit').click();
    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 15000 });
  });
});
