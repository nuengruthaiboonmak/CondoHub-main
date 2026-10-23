import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { loginAsPoolAdmin } from '../../helpers/owner';
import { readRunContext } from '../../fixtures/run-context';

test('cross-admin deletions and deactivations recheck the acting account inside the transaction', async ({
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
      'e2e/fixtures/admin-lifecycle-race.ts',
      runId,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf-8' },
  );
  expect(JSON.parse(output)).toEqual([
    { succeeded: 1, active: 1 },
    { succeeded: 1, active: 1 },
    { succeeded: 1, active: 1 },
  ]);
});
