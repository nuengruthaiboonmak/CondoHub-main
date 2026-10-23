import { test as base, expect } from '@playwright/test';
import { open, readFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const test = base.extend<{ projectPaymentSettings: void }>({
  projectPaymentSettings: [
    async ({}, use) => {
      const directory = path.resolve(process.cwd(), '.agent');
      await mkdir(directory, { recursive: true });
      const lock = path.join(directory, 'e2e-project-payment-settings.lock');
      const deadline = Date.now() + 180000;
      while (true) {
        try {
          const handle = await open(lock, 'wx');
          await handle.writeFile(String(process.pid));
          await handle.close();
          break;
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST')
            throw error;
          const pid = Number(await readFile(lock, 'utf-8').catch(() => ''));
          if (Number.isInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 0);
            } catch {
              await unlink(lock).catch(() => undefined);
            }
          }
          if (Date.now() > deadline)
            throw new Error('Timed out waiting for the shared project payment settings test.');
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      try {
        await use();
      } finally {
        await unlink(lock).catch(() => undefined);
      }
    },
    { auto: true, timeout: 240000 },
  ],
});
export { expect };
