import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiJson } from './api';
import { poolAdminFor, readRunContext } from '../fixtures/run-context';

interface ProvisionResult {
  data: { created: boolean; userId: string; tempPassword?: string };
}

interface TransferResult {
  data: { endedOwnershipId: string; createdOwnershipId: string; effectiveAt: string };
}

let lastAuthAttempt = 0;

const uniqueTag = Date.now().toString(36).slice(-4);

export function uniqueUsername(stem: string): string {
  return `${stem}${uniqueTag}`.slice(0, 30);
}

async function paceAuthAttempts(): Promise<void> {
  const now = Date.now();
  const wait = 5000 - (now - lastAuthAttempt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastAuthAttempt = Date.now();
}

async function submitLogin(page: Page, username: string, password: string): Promise<number | null> {
  await page.goto('/login');
  await page.getByTestId('login-username').fill(username);
  await page.getByTestId('login-password').fill(password);
  const submitted = page.waitForResponse(
    (response) => response.url().includes('/api/auth/sign-in/username'),
    { timeout: 15000 },
  );
  await page.getByTestId('login-submit').click();
  const answered = await submitted.then(
    (response) => response,
    () => null,
  );
  if (answered === null) return null;
  lastAuthAttempt = Date.now();
  const status = answered.status();
  if (status === 429) {
    const retryAfter = await answered.headerValue('x-retry-after').catch(() => null);
    const waitSeconds = retryAfter === null ? NaN : Number.parseInt(retryAfter, 10);
    const waitMs =
      Number.isFinite(waitSeconds) && waitSeconds > 0 ? (waitSeconds + 2) * 1000 : 15000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return 429;
  }
  return status;
}

async function loginWithRetry(page: Page, username: string, password: string): Promise<void> {
  await paceAuthAttempts();
  const status = await submitLogin(page, username, password);
  if (status === 429) {
    await paceAuthAttempts();
    await submitLogin(page, username, password);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
    return;
  }
  try {
    await expect(page).not.toHaveURL(/\/login/, { timeout: 8000 });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 12000));
    lastAuthAttempt = Date.now();
    await submitLogin(page, username, password);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
  }
}

async function signInFromApi(
  request: APIRequestContext,
  input: { username: string; password: string },
): Promise<{ status: number; json: unknown }> {
  await paceAuthAttempts();
  const first = await apiJson<unknown>(request, {
    method: 'POST',
    path: '/api/auth/sign-in/username',
    body: { username: input.username, password: input.password },
  });
  lastAuthAttempt = Date.now();
  if (first.status !== 429) return first;
  await new Promise((resolve) => setTimeout(resolve, 62000));
  lastAuthAttempt = Date.now();
  const second = await apiJson<unknown>(request, {
    method: 'POST',
    path: '/api/auth/sign-in/username',
    body: { username: input.username, password: input.password },
  });
  lastAuthAttempt = Date.now();
  return second;
}

export async function submitFirstLoginStep(
  page: Page,
  input: { username: string; tempPassword: string },
): Promise<void> {
  await paceAuthAttempts();
  const status = await submitLogin(page, input.username, input.tempPassword);
  if (status === 429) {
    await paceAuthAttempts();
    await submitLogin(page, input.username, input.tempPassword);
  }
  await expect(page).toHaveURL(/\/change-password/, { timeout: 15000 });
}

export async function signInSuspendedActor(
  request: APIRequestContext,
  input: { username: string; password: string },
): Promise<{ status: number; json: { token?: string } }> {
  const signed = await signInFromApi(request, input);
  return signed as { status: number; json: { token?: string } };
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await loginWithRetry(
    page,
    process.env.E2E_ADMIN_USERNAME ?? 'admin',
    process.env.E2E_ADMIN_PASSWORD ?? '',
  );
}

export async function loginAsPoolAdmin(page: Page, fileKey: string): Promise<void> {
  const ctx = await readRunContext();
  const picked = poolAdminFor(ctx, fileKey);
  await loginWithRetry(page, picked.username, picked.tempPassword);
}

export async function loginAsUser(page: Page, username: string, password: string): Promise<void> {
  await loginWithRetry(page, username, password);
}

export async function provisionUser(
  page: Page,
  input: { username: string; name: string },
): Promise<{ userId: string; tempPassword: string }> {
  const provisioned = await apiJson<ProvisionResult>(page.request, {
    method: 'POST',
    path: '/api/admin/users',
    body: {
      username: input.username,
      email: `${input.username}@example.invalid`,
      name: input.name,
    },
  });
  expect(provisioned.status).toBe(200);
  const tempPassword = provisioned.json.data.tempPassword;
  expect(typeof tempPassword).toBe('string');
  return { userId: provisioned.json.data.userId, tempPassword: tempPassword as string };
}

export async function completeFirstLogin(
  page: Page,
  input: { username: string; tempPassword: string; newPassword: string },
): Promise<void> {
  await submitFirstLoginStep(page, { username: input.username, tempPassword: input.tempPassword });
  await page.getByTestId('change-password-current').fill(input.tempPassword);
  await page.getByTestId('change-password-new').fill(input.newPassword);
  await page.getByTestId('change-password-confirm').fill(input.newPassword);
  await page.getByTestId('change-password-submit').click();
  await expect(page).toHaveURL(/\/login/);
  await loginAsUser(page, input.username, input.newPassword);
}

export async function transferRoomTo(
  page: Page,
  input: { roomId: string; fromUserId: string; toUserId: string },
): Promise<void> {
  const transferred = await apiJson<TransferResult>(page.request, {
    method: 'POST',
    path: `/api/admin/rooms/${input.roomId}/ownerships`,
    body: {
      action: 'TRANSFER',
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      effectiveAt: new Date().toISOString(),
    },
  });
  expect(transferred.status).toBe(200);
}

export async function roomOwnerAt(
  page: Page,
  roomId: string,
): Promise<string> {
  const detail = await apiJson<{ data: { owners: Array<{ userId: string }> } }>(page.request, {
    method: 'GET',
    path: `/api/rooms/${roomId}`,
  });
  expect(detail.status).toBe(200);
  const owner = detail.json.data.owners[0]?.userId;
  expect(typeof owner).toBe('string');
  return owner as string;
}
