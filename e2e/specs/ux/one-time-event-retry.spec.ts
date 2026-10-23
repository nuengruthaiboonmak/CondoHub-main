import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';

test('a partial one-time event stays open until failed rooms are repaired and retried without duplicate invoices', async ({
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
      'e2e/fixtures/one-time-event-retry.ts',
      runId,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf-8', timeout: 90000 },
  );
  expect(JSON.parse(output)).toEqual({
    first: { created: 1, errors: 1, status: 'OPEN' },
    retry: { created: 1, skipped: 1, errors: 0, status: 'ISSUED' },
    repeated: { created: 0 },
    invoices: 2,
  });
});
