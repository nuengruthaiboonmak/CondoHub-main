import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';

test('deleting the last private manager requires closing rentals, original repair work and unpaid invoices', async ({
  page,
}) => {
  test.setTimeout(120000);
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const output = execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      '--conditions=react-server',
      'e2e/fixtures/account-responsibilities.ts',
      runId,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf-8', timeout: 90000 },
  );
  const result = JSON.parse(output) as { roomId: string };
  expect(result).toMatchObject({
    activeRentalBlocked: true,
    historicalWorkBlocked: true,
    unpaidInvoiceBlocked: true,
    retained: { reviewers: 1, recipients: 1, deleted: 1 },
  });
  await page.goto(`/rooms/${result.roomId}`);
  await expect(page.getByText('Account deleted', { exact: true })).toBeVisible();
});
