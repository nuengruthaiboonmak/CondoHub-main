import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';

test('manual issuance processes at most 25 target rooms and fixes its audience until completion', async ({
  page,
}) => {
  test.setTimeout(180000);
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const output = execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      '--conditions=react-server',
      'e2e/fixtures/event-batch.ts',
      runId,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf-8', timeout: 60000 },
  );
  const { eventId, roomIds } = JSON.parse(output) as { eventId: string; roomIds: string[] };
  const path = `/api/admin/billing/common-fee-events/${eventId}/issue`;
  const first = await page.request.post(path, { data: { roomIds } });
  expect(first.status()).toBe(200);
  expect((await first.json()).data).toMatchObject({ created: 25, remaining: 1, status: 'OPEN' });
  expect((await page.request.post(path, { data: { roomIds: [roomIds[0]] } })).status()).toBe(400);
  const second = await page.request.post(path, { data: {} });
  expect(second.status()).toBe(200);
  expect((await second.json()).data).toMatchObject({
    created: 1,
    remaining: 0,
    issued: 26,
    status: 'ISSUED',
  });
  const invoiceResponse = await page.request.get(
    `/api/invoices?oneTimeChargeEventId=${eventId}&pageSize=100`,
  );
  const invoices = (await invoiceResponse.json()).data as Array<{ roomId: string }>;
  expect(invoices).toHaveLength(26);
  expect([...new Set(invoices.map((row) => row.roomId))].sort()).toEqual([...roomIds].sort());
});
