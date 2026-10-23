import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loginAsPoolAdmin } from '../../helpers/owner';
import { readRunContext } from '../../fixtures/run-context';
import { findRoom } from '../booking/bookingFlow';
import { createFacility } from '../booking/bookingFlow';

test('facility deletion removes the directory entry and prevents further access', async ({
  page,
}) => {
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const code = `E2E-${runId}-delete-${randomUUID().slice(0, 8)}`;
  const facility = await createFacility(page, { code, name: code });
  const deleted = await page.request.delete(`/api/admin/facilities/${facility.id}`, {
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(deleted.status()).toBe(200);
  expect((await page.request.get(`/api/admin/facilities/${facility.id}`)).status()).toBe(404);
  expect(
    (
      await page.request.patch(`/api/admin/facilities/${facility.id}`, {
        data: { status: 'ACTIVE' },
      })
    ).status(),
  ).toBe(404);
  await page.goto(`/admin/facilities?query=${encodeURIComponent(code)}`);
  await expect(page.getByTestId(`admin-facilities-row-${facility.id}`)).toHaveCount(0);
});

test('deletion guards upcoming bookings and keeps cancelled and historical slots readable', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await loginAsPoolAdmin(page, 'workspace');
  const { runId } = await readRunContext();
  const code = `E2E-${runId}-delete-guard-${randomUUID().slice(0, 8)}`;
  const facility = await createFacility(page, { code, name: code });
  const roomId = await findRoom(page, `E2E-${runId}-301`);
  const session = await page.request.get('/api/auth/get-session');
  const userId = (await session.json()).user.id as string;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      '--conditions=react-server',
      'e2e/fixtures/facility-delete-booking.ts',
      facility.id,
      roomId,
      userId,
      runId,
    ],
    {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, SEED_ENABLED: 'true', NODE_ENV: 'development' },
    },
  );
  const fixture = JSON.parse(stdout.trim()) as { bookingId: string; slotIds: string[] };
  const outsider = await browser.newContext();
  try {
    expect(
      (
        await outsider.request.delete(
          `${process.env.TEST_BASE_URL ?? 'http://localhost:3000'}/api/admin/facilities/${facility.id}`,
        )
      ).status(),
    ).toBe(401);
  } finally {
    await outsider.close();
  }
  const blocked = await page.request.delete(`/api/admin/facilities/${facility.id}`);
  expect(blocked.status()).toBe(400);
  expect((await blocked.json()).error.message).toContain('Cancel active or upcoming bookings');
  expect((await page.request.get(`/api/admin/facilities/${facility.id}`)).status()).toBe(200);
  const cancelled = await page.request.post(
    `/api/bookings/${fixture.bookingId}/slots/${fixture.slotIds[1]}/cancel`,
    { data: { reason: 'Confirm deletion preserves booking history.', refundQuota: true } },
  );
  expect(cancelled.status()).toBe(200);
  await page.goto(`/admin/facilities/${facility.id}`);
  await page.getByTestId('facility-actions-trigger').click();
  await page.getByTestId('facility-delete-open').click();
  await expect(page.getByTestId('facility-delete-dialog')).toBeVisible();
  await page
    .getByTestId('facility-delete-dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.getByTestId('facility-actions-trigger')).toBeFocused();
  await page.getByTestId('facility-actions-trigger').click();
  await page.getByTestId('facility-delete-open').click();
  await page.getByTestId('facility-delete-submit').click();
  await expect(page).toHaveURL(/\/admin\/facilities$/);
  const history = await page.request.get(`/api/bookings?roomId=${roomId}`);
  expect(history.status()).toBe(200);
  const row = (
    (await history.json()).data.bookings as Array<{ id: string; slots: Array<{ state: string }> }>
  ).find((entry) => entry.id === fixture.bookingId);
  expect(row?.slots.map((slot) => slot.state).sort()).toEqual(['ADMIN_CANCELLED', 'CONFIRMED']);
  await page.goto(`/rooms/${roomId}/bookings`);
  await expect(page.getByTestId(`room-bookings-facility-${fixture.bookingId}`)).toContainText(code);
  await expect(page.getByTestId(`room-bookings-facility-${fixture.bookingId}`)).toContainText(
    'Deleted facility',
  );
});
