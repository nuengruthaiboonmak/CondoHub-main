import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface PoolAdmin {
  username: string;
  tempPassword: string;
}

export interface RunContext {
  runId: string;
  createdAt: string;
  admins?: PoolAdmin[] | undefined;
}

export async function readRunContext(): Promise<RunContext> {
  const raw = await readFile(path.join(__dirname, '..', '.run.json'), 'utf8');
  const parsed = JSON.parse(raw) as RunContext;
  if (typeof parsed.runId !== 'string' || parsed.runId === '') {
    throw new Error('E2E run file is missing runId.');
  }
  return parsed;
}

export function poolAdminFor(ctx: RunContext, fileKey: string): PoolAdmin {
  const admins = ctx.admins ?? [];
  if (admins.length === 0) {
    return {
      username: process.env.E2E_ADMIN_USERNAME ?? 'admin',
      tempPassword: process.env.E2E_ADMIN_PASSWORD ?? '',
    };
  }
  let hash = 0;
  for (const char of fileKey) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const picked = admins[hash % admins.length];
  if (picked === undefined) throw new Error('Admin pool pick failed.');
  return picked;
}

export function namespaced(prefix: string, runId: string, name: string): string {
  return `${prefix}_${runId}_${name}`;
}

export function runUsername(runId: string, suffix: string): string {
  return `e2e${runId.replace(/[^a-z0-9]/gi, '').toLowerCase()}${suffix}`.slice(0, 30);
}

export function workerNamespace(runId: string, workerIndex: number): string {
  return `${runId}-w${workerIndex}`;
}
