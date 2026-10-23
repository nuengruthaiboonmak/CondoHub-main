import type { Browser, Page } from '@playwright/test';
import { completeFirstLogin, provisionUser, uniqueUsername } from './owner';
import { workerNamespace } from '../fixtures/run-context';

export interface ResidentSession {
  page: Page;
  username: string;
  close: () => Promise<void>;
}

export async function provisionResidentWithRetry(
  adminPage: Page,
  browser: Browser,
  input: { runId: string; workerIndex: number; stem: string; baseURL: string },
): Promise<ResidentSession> {
  const ns = workerNamespace(input.runId, input.workerIndex);
  const suffix = ns.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const username = uniqueUsername(`e2e${suffix}${input.stem}`);
  const resident = await provisionUser(adminPage, { username, name: `${input.stem} ${ns}` });
  const newPassword = `Resident-${suffix}-pw1`;
  const context = await browser.newContext({ baseURL: input.baseURL });
  const page = await context.newPage();
  try {
    await completeFirstLogin(page, {
      username,
      tempPassword: resident.tempPassword,
      newPassword,
    });
  } catch {
    await page.waitForTimeout(15000);
    await completeFirstLogin(page, {
      username,
      tempPassword: resident.tempPassword,
      newPassword,
    });
  }
  return {
    page,
    username,
    close: () => context.close(),
  };
}
