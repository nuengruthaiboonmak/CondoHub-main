import { randomUUID } from 'node:crypto';
import { readRunContext } from '../../fixtures/run-context';
import { apiJson } from '../../helpers/api';
import { expect, test } from '@playwright/test';
import { loginAsPoolAdmin } from '../../helpers/owner';

test('building management uses floor navigation and compact contextual actions', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await loginAsPoolAdmin(page, 'workspace');
  await page.goto('/admin/buildings');
  await page
    .getByTestId(/^admin-buildings-row-/)
    .first()
    .click();
  await expect(page.getByTestId('building-actions-trigger')).toBeVisible();
  await page.getByTestId('building-actions-trigger').click();
  await page.getByTestId('building-edit-open').click();
  await expect(page.getByTestId('building-edit-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('building-actions-trigger')).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Building floors' })).toBeVisible();
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('building-actions-trigger').click();
    const menu = await page.getByTestId('building-actions-dropdown').boundingBox();
    expect(menu?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((menu?.x ?? 0) + (menu?.width ?? 0)).toBeLessThanOrEqual(width);
    expect((menu?.y ?? 0) + (menu?.height ?? 0)).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`building-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByTestId('building-actions-trigger').press('ArrowDown');
    await expect(page.getByTestId('building-edit-open')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('building-actions-trigger')).toBeFocused();
  }
});

test('profile password dialog can be cancelled without leaving the workspace', async ({ page }) => {
  test.setTimeout(90000);
  await loginAsPoolAdmin(page, 'workspace');
  await page.goto('/admin/buildings');
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('user-menu-change-password').click();
  await expect(page.getByTestId('account-password-dialog')).toBeVisible();
  await page.getByTestId('change-password-submit').click();
  await expect(page.getByTestId('change-password-current')).toBeFocused();
  await page.getByTestId('account-password-cancel').click();
  await expect(page).toHaveURL(/\/admin\/buildings$/);
  await expect(page.getByTestId('account-password-dialog')).toHaveCount(0);
});

test('invoice amounts align left and payment summary cards stretch equally', async ({ page }) => {
  await loginAsPoolAdmin(page, 'workspace');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/admin/billing/invoices');
  const table = page.getByTestId('invoice-list');
  for (const index of [2, 3, 4]) {
    await expect(table.getByRole('columnheader').nth(index)).toHaveCSS(
      'text-align',
      /^(left|start)$/,
    );
    await expect(table.getByRole('row').nth(1).getByRole('cell').nth(index)).toHaveCSS(
      'text-align',
      /^(left|start)$/,
    );
  }
  await page
    .getByTestId(/^invoice-row-/)
    .first()
    .click();
  const balance = await page.getByRole('region', { name: 'Balance', exact: true }).boundingBox();
  const payment = await page.getByRole('region', { name: 'How to pay', exact: true }).boundingBox();
  expect(Math.abs((balance?.height ?? 0) - (payment?.height ?? 0))).toBeLessThan(2);
});

test('floor actions open beside the row and the new floor form uses its full compact width', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const created = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/buildings',
    body: { projectId: randomUUID(), name: `E2E-${runId}-FloorFlyout`, status: 'ACTIVE' },
  });
  expect(created.status).toBe(200);
  await page.goto(`/admin/buildings/${created.json.data.id}`);
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('floor-create-open').click();
    const dialog = page.getByTestId('floor-create-dialog');
    await expect(dialog).toBeVisible();
    const formBox = await page.getByTestId('floor-create-form').boundingBox();
    const inputBox = await page.getByTestId('floor-create-label').boundingBox();
    expect(inputBox!.width).toBeGreaterThan(formBox!.width * 0.95);
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(400);
    await page.screenshot({
      path: testInfo.outputPath(`new-floor-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('floor-create-open')).toBeFocused();
  }
  await page.getByTestId('floor-create-open').click();
  await page.getByTestId('floor-create-label').fill('Ground floor');
  await page.getByTestId('floor-create-submit').click();
  await expect(page.getByTestId('floor-create-dialog')).not.toBeVisible();
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.getByRole('button', { name: 'Actions for Ground floor' });
    await trigger.click();
    const dropdown = page.getByRole('group', { name: 'Actions for Ground floor' });
    await expect(dropdown).toBeVisible();
    expect(await dropdown.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(
      true,
    );
    expect(await dropdown.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const box = (await dropdown.boundingBox())!;
    const anchor = (await trigger.boundingBox())!;
    if (width === 1366) expect(box.x).toBeGreaterThanOrEqual(anchor.x + anchor.width);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`floor-actions-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await trigger.press('ArrowDown');
    await expect(dropdown.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
});
