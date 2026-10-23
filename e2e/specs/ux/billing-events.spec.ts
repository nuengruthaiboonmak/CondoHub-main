import { expect, test } from '@playwright/test';
import { loginAsPoolAdmin } from '../../helpers/owner';
import { readRunContext } from '../../fixtures/run-context';

test('billing events retain their purpose in the list and detail after creating through UI', async ({
  page,
}, info) => {
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const note = `E2E-${runId} Elevator repair contribution for the north tower shared spaces and replacement parts`;
  await page.goto('/admin/billing/events');
  await page.getByTestId('charge-event-list-new').click();
  await page.getByTestId('charge-event-create-date').fill('2026-12-15');
  await page.getByTestId('charge-event-create-amount').fill('500.00');
  await page.getByTestId('charge-event-create-note').fill(note);
  await page.getByTestId('charge-event-create-submit').click();
  await expect(page.getByTestId('charge-event-detail-page')).toBeVisible();
  const eventId = page.url().split('/').at(-1)!;
  await expect(page.getByTestId('charge-event-detail-note')).toHaveText(note);
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`event-detail-${width}.png`), fullPage: true });
  }
  await page.getByTestId('charge-event-detail-back').click();
  await expect(page.getByTestId(`charge-event-row-${eventId}`)).toContainText(note);
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`event-list-${width}.png`), fullPage: true });
  }
});
