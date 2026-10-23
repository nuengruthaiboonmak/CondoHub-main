import { expect, test } from '@playwright/test';
import { loginAsPoolAdmin } from '../../helpers/owner';

test('users columns have bounded widths, truncate long content and support resizing', async ({
  page,
}, testInfo) => {
  await loginAsPoolAdmin(page, 'workspace');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/admin/users');
  const table = page.getByTestId('admin-users-table');
  const name = table.getByRole('columnheader').nth(1);
  const before = (await name.boundingBox())?.width ?? 0;
  expect(before).toBeGreaterThan(100);
  expect(before).toBeLessThan(400);
  const handle = page.getByTestId('admin-users-table-resize-name');
  const rect = await handle.boundingBox();
  if (!rect) throw new Error('Column resize handle is missing.');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 80, rect.y + rect.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await name.boundingBox())?.width ?? 0).toBeGreaterThan(before + 60);
  await handle.focus();
  const resized = (await name.boundingBox())?.width ?? 0;
  await page.keyboard.press('ArrowLeft');
  expect((await name.boundingBox())?.width ?? 0).toBeLessThan(resized - 10);
  await page.keyboard.press('Home');
  expect(Math.abs(((await name.boundingBox())?.width ?? 0) - before)).toBeLessThan(2);
  await expect(table.locator('td').first().locator('div')).toHaveCSS('text-overflow', 'ellipsis');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('users-columns.png'), fullPage: true });
});
