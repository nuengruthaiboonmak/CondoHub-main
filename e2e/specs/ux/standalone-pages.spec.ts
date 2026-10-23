import { expect, test } from '@playwright/test';
import { loginAsPoolAdmin } from '../../helpers/owner';

test('standalone creation pages retain navigation, usable fields and consistent controls at every viewport', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await loginAsPoolAdmin(page, 'workspace');
  for (const [route, id, back] of [
    ['/admin/buildings/new', 'admin-building-new-page', '/admin/buildings'],
    ['/admin/facilities/new', 'admin-facility-new-page', '/admin/facilities'],
    ['/admin/announcements/new', 'admin-announcement-new-page', '/admin/announcements'],
    ['/admin/billing/events/new', 'charge-event-new-page', '/admin/billing/events'],
    ['/maintenance/new', 'maintenance-new-page', '/maintenance'],
  ] as const) {
    for (const width of [360, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      const main = page.getByTestId(id);
      await expect(main).toBeVisible();
      await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const select of await main.locator('select').all())
        expect(
          await select.evaluate(
            (element) => element.closest('[data-ui-select]')?.querySelectorAll('svg').length,
          ),
        ).toBe(2);
      await page.screenshot({
        path: info.outputPath(`${id}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await main.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page).toHaveURL(back);
    }
  }
  await page.goto('/admin/ownership');
  await expect(page).toHaveURL('/rooms');
});
