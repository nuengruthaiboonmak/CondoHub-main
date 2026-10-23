import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { readRunContext } from './fixtures/run-context';

const execFileAsync = promisify(execFile);

export default async function globalTeardown(): Promise<void> {
  const ctx = await readRunContext().catch(() => null);
  if (ctx === null) return;
  await execFileAsync('pnpm', ['db:seed:reset', '--', '--run', ctx.runId], {
    shell: process.platform === 'win32',
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, E2E_RUN_ID: ctx.runId },
  }).catch((error: unknown) => {
    console.error(JSON.stringify({ event: 'e2e-teardown-failed', runId: ctx.runId, error: String(error) }));
  });
}
