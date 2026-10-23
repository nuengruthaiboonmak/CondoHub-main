import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface E2ERunFile {
  runId: string;
  createdAt: string;
  admins: Array<{ username: string; tempPassword: string }>;
}

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, (match) => (match === 'T' ? '-' : ''));
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

async function provisionPoolAdmin(
  root: string,
  baseEnv: NodeJS.ProcessEnv,
  username: string,
): Promise<{ username: string; tempPassword: string }> {
  const { stdout } = await execFileAsync('pnpm', ['db:seed:e2e-admin'], {
    shell: process.platform === 'win32',
    cwd: root,
    env: { ...baseEnv, E2E_ADMIN_USERNAME: username },
  });
  const passwordLine = stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('E2E_ADMIN_PASSWORD='));
  const tempPassword = passwordLine?.slice('E2E_ADMIN_PASSWORD='.length) ?? '';
  if (tempPassword === '') throw new Error(`Pool admin provision produced no password for ${username}.`);
  return { username, tempPassword };
}

export default async function globalSetup(): Promise<void> {
  const runId = process.env.E2E_RUN_ID ?? newRunId();
  const root = path.resolve(__dirname, '..');
  await execFileAsync('pnpm', ['db:seed:e2e', '--', '--run', runId], {
    shell: process.platform === 'win32',
    cwd: root,
    env: { ...process.env, E2E_RUN_ID: runId },
  });
  const safeRun = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const admins: Array<{ username: string; tempPassword: string }> = [];
  for (const stem of ['img0', 'img1', 'img2']) {
    admins.push(
      await provisionPoolAdmin(root, process.env, `e2e${safeRun}${stem}`.slice(0, 30)),
    );
  }
  const payload: E2ERunFile = { runId, createdAt: new Date().toISOString(), admins };
  await writeFile(path.join(__dirname, '.run.json'), JSON.stringify(payload, null, 2));
}
