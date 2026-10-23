import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';

interface Envelope<T> {
  data: T;
}

interface ProvisionResult {
  created: boolean;
  userId: string;
  tempPassword?: string;
}

test.describe('golden path #1: admin onboards a user', () => {
  test('provision, first login, forced password change, active session', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const username = `e2e${suffix}onboard`;
    const email = `${username}@example.invalid`;

    await page.goto('/login');
    await page.getByTestId('login-username').fill(process.env.E2E_ADMIN_USERNAME ?? 'admin');
    await page.getByTestId('login-password').fill(process.env.E2E_ADMIN_PASSWORD ?? '');
    await page.getByTestId('login-submit').click();
    await expect(page).not.toHaveURL(/\/login/);

    const provisioned = await apiJson<Envelope<ProvisionResult>>(page.request, {
      method: 'POST',
      path: '/api/admin/users',
      body: { username, email, name: `E2E Onboard ${ns}` },
    });
    expect(provisioned.status).toBe(200);
    expect(provisioned.json.data.created).toBe(true);
    const tempPassword = provisioned.json.data.tempPassword;
    expect(typeof tempPassword).toBe('string');
    expect((tempPassword as string).length).toBeGreaterThanOrEqual(16);

    await page.goto('/login');
    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(tempPassword as string);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/change-password/);

    const blocked = await apiJson<unknown>(page.request, {
      method: 'GET',
      path: '/api/admin/users?pageSize=1',
    });
    expect(blocked.status).toBe(403);

    const newPassword = `New-${ns}-password-1`;
    await page.getByTestId('change-password-current').fill(tempPassword as string);
    await page.getByTestId('change-password-new').fill(newPassword);
    await page.getByTestId('change-password-confirm').fill(newPassword);
    await page.getByTestId('change-password-submit').click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(newPassword);
    await page.getByTestId('login-submit').click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/\/change-password/);
  });
});
