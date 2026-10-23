import { expect, test } from '@playwright/test';
import { loginAsPoolAdmin } from '../../helpers/owner';

test('remaining workspace screens stay usable across viewport sizes', async ({
  page,
}, testInfo) => {
  test.setTimeout(240000);
  await loginAsPoolAdmin(page, 'workspace');
  const paths = [
    '/admin/buildings',
    '/admin/users',
    '/admin/announcements',
    '/admin/billing/invoices',
    '/admin/billing/events',
    '/admin/billing/settings',
    '/admin/billing/turnover-reviews',
    '/admin/billing/job-runs',
    '/admin/maintenance',
    '/rooms',
    '/facilities',
  ];
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${path} at ${width}`,
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${path.replaceAll('/', '-')}-${width}.png`),
        fullPage: true,
      });
    }
    await page.goto('/admin/facilities');
    await page
      .getByTestId(/^admin-facilities-row-/)
      .first()
      .click();
    await expect(page.getByTestId('admin-facility-detail-page')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`facility-admin-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Resident view', exact: true }).click();
    await expect(page.getByTestId('facility-detail-page')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`facility-resident-${width}.png`),
      fullPage: true,
    });
  }
});
