import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { expect, test } from '@playwright/test';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';

test.describe('connected workspace', () => {
  test.setTimeout(120000);

  test('keeps administration available in workspace and puts account actions in a dropdown', async ({
    page,
  }) => {
    await loginAsPoolAdmin(page, 'workspace');
    await page.goto('/rooms');
    await expect(page.getByTestId('nav-buildings')).toBeVisible();
    await expect(page.getByTestId('nav-facilities')).toBeVisible();
    await expect(page.getByTestId('admin-return-banner')).toHaveCount(0);
    await expect(page.getByTestId('user-menu-sign-out')).toHaveCount(0);
    await page.getByTestId('user-menu-trigger').click();
    await expect(page.getByTestId('user-menu-change-password')).toBeVisible();
    const trigger = await page.getByTestId('user-menu-trigger').boundingBox();
    const menu = await page.getByTestId('user-menu-dropdown').boundingBox();
    expect(trigger && menu && menu.y + menu.height <= trigger.y).toBeTruthy();
    expect(
      trigger && trigger.y + trigger.height <= (page.viewportSize()?.height ?? 0),
    ).toBeTruthy();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('user-menu-trigger')).toBeFocused();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByTestId('app-nav-open').click();
    await expect(page.getByTestId('app-nav-sheet').getByTestId('nav-buildings')).toBeVisible();
    await page.getByTestId('app-nav-sheet').getByTestId('user-menu-trigger').click();
    await expect(page.getByTestId('user-menu-dropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('app-nav-sheet')).toBeVisible();
    await expect(page.getByTestId('user-menu-dropdown')).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('creates named structures in dialogs and exposes owner assignment from the room', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    await loginAsPoolAdmin(page, 'workspace');
    const name = `E2E-${runId}-Workspace-${Date.now().toString(36).slice(-4)}`;
    await page.goto('/admin/buildings');
    await page.getByTestId('admin-buildings-create').click();
    await expect(page.getByRole('dialog', { name: 'New building', exact: true })).toBeVisible();
    await expect(page.getByLabel('Code', { exact: true })).toHaveCount(0);
    await page.getByTestId('building-create-name').fill(name);
    await page.getByTestId('building-create-submit').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', { name, exact: true }).click();
    await page.getByTestId('floor-create-open').click();
    await page.getByTestId('floor-create-label').fill(`${name} Ground floor`);
    await page.getByTestId('floor-create-submit').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('room-create-open').click();
    await page.getByTestId('room-create-name').fill(`${name} 101`);
    await page.getByTestId('room-create-area').fill('42.5');
    await page.getByTestId('room-create-floor').selectOption({ label: `${name} Ground floor` });
    await page.getByTestId('room-create-submit').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(`${name} 101`, { exact: true })).toBeVisible();
    const peopleLink = page.getByTestId(/^room-people-link-/).first();
    const roomId = (await peopleLink.getAttribute('href'))?.split('/').pop() ?? '';
    const before = await apiJson<{ data: { roomCode: string } }>(page.request, {
      method: 'GET',
      path: `/api/rooms/${roomId}`,
    });
    const renamed = await apiJson<{ data: { id: string; name: string; roomCode: string } }>(
      page.request,
      {
        method: 'PATCH',
        path: `/api/admin/rooms/${roomId}`,
        body: { name: `${name} Garden suite` },
      },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.json.data.name).toBe(`${name} Garden suite`);
    expect(renamed.json.data.roomCode).toBe(before.json.data.roomCode);
    await peopleLink.click();
    await expect(page.getByTestId('room-detail-title')).toContainText(`${name} Garden suite`);
    for (const width of [360, 768, 1366]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`room-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Assign owner', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Assign owner', exact: true })).toBeVisible();
    await page.getByTestId('ownership-assign-username').fill('unsaved.owner');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByTestId('ownership-assign-username')).toHaveValue('unsaved.owner');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
  test('paginates searched buildings without losing the search', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsPoolAdmin(page, 'workspace');
    const prefix = `E2E-${runId}-Paging-${Date.now().toString(36).slice(-4)}`;
    const projectId = randomUUID();
    for (let index = 0; index < 13; index += 1) {
      const created = await apiJson<{ data: { id: string } }>(page.request, {
        method: 'POST',
        path: '/api/admin/buildings',
        body: { projectId, name: `${prefix} ${String(index).padStart(2, '0')}`, status: 'ACTIVE' },
      });
      expect(created.status).toBe(200);
    }
    await page.goto(`/admin/buildings?query=${encodeURIComponent(prefix)}`);
    await expect(page.getByTestId('admin-buildings-list').locator('li')).toHaveCount(12);
    await page.getByTestId('admin-buildings-pages-page-2').click();
    await expect(page).toHaveURL(/query=/);
    await expect(page.getByTestId('admin-buildings-list').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('admin-buildings-list')).toContainText(`${prefix} 12`);
  });
});
