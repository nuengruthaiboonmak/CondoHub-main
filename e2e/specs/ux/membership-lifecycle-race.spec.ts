import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';

test('a queued membership cannot join a rental cancelled or ended before its write', async ({
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
      'e2e/fixtures/membership-lifecycle-race.ts',
      runId,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf-8', timeout: 90000 },
  );
  expect(JSON.parse(output)).toEqual([
    { action: 'CANCEL', outcome: 'VALIDATION_ERROR', memberships: 0 },
    { action: 'END', outcome: 'VALIDATION_ERROR', memberships: 0 },
  ]);
});
