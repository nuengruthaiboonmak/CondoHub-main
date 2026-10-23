import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';

test('editing booking rules invalidates the previous impact preview', async ({ page }) => {
  test.setTimeout(120000);
  const { runId } = await readRunContext();
  await loginAsPoolAdmin(page, 'workspace');
  const days = Object.fromEntries(
    ['0', '1', '2', '3', '4', '5', '6'].map((day) => [
      day,
      { open: [{ start: '08:00', end: '20:00' }], breaks: [] },
    ]),
  );
  const created = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/facilities',
    body: {
      projectId: randomUUID(),
      name: `E2E-${runId}-Preview`,
      status: 'ACTIVE',
      capacity: 2,
      schedule: { days, holidays: [] },
      slotMinutes: 60,
      quotaKind: 'DAILY',
      quotaLimit: 5,
      advanceDays: 30,
    },
  });
  expect(created.status).toBe(200);
  await page.goto(`/admin/facilities/${created.json.data.id}`);
  await page.getByTestId('config-change-open').click();
  await page
    .getByTestId('config-change-effective-at')
    .fill(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16));
  await page.getByTestId('config-change-preview').click();
  await expect(page.getByTestId('config-change-preview-result')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('config-change-advance-days').fill('29');
  await expect(page.getByTestId('config-change-preview-result')).toHaveCount(0);
  await page.getByTestId('config-change-preview').click();
  await expect(page.getByTestId('config-change-preview-result')).toBeVisible({ timeout: 15000 });
});
