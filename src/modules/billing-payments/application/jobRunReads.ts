import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import type { JobRunState } from '@/shared/db/schema/jobs';
import { findJobRunById, listJobRuns } from '../infrastructure/jobRunRepository';
import { assertRedactedJobResult, type AdminJobResult } from '../domain/jobRedaction';

export interface JobRunListItem {
  id: string;
  jobName: string;
  businessKey: string;
  state: JobRunState;
  result: AdminJobResult | null;
  attempt: number;
  triggerSource: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface JobRunPage {
  rows: JobRunListItem[];
  total: number;
}

export interface JobRunDetail extends JobRunListItem {
  heartbeatAt: string;
  createdAt: string;
  updatedAt: string;
}

function assertAdmin(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
}

function toListItem(row: {
  id: string;
  jobName: string;
  businessKey: string;
  state: JobRunState;
  result: unknown;
  attempt: number;
  triggerSource: string;
  startedAt: Date;
  finishedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}): JobRunListItem {
  return {
    id: row.id,
    jobName: row.jobName,
    businessKey: row.businessKey,
    state: row.state,
    result: assertRedactedJobResult(row.result, row.jobName),
    attempt: row.attempt,
    triggerSource: row.triggerSource,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  };
}

function assertNoPrivateLeak(result: AdminJobResult | null): void {
  if (result === null) return;
  const keys = Object.keys(result as unknown as Record<string, unknown>);
  for (const key of keys) {
    if (key.toLowerCase().includes('private')) {
      throw new AppError('INTERNAL_ERROR', 'The job result shape is invalid.');
    }
  }
}

export async function listAdminJobRuns(
  actor: Actor,
  input: {
    jobName?: 'generate-invoices' | 'sweep-orphans' | undefined;
    state?: JobRunState | undefined;
    page: number;
    pageSize: number;
  },
  conn: Db = db,
): Promise<JobRunPage> {
  assertAdmin(actor);
  const limit = Math.min(Math.max(input.pageSize, 1), 100);
  const offset = (Math.max(input.page, 1) - 1) * limit;
  const page = await listJobRuns(conn, {
    limit,
    offset,
    ...(input.jobName !== undefined ? { jobName: input.jobName } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
  });
  const rows = page.rows.map(toListItem);
  for (const row of rows) assertNoPrivateLeak(row.result);
  return { rows, total: page.total };
}

export async function getAdminJobRun(
  actor: Actor,
  id: string,
  conn: Db = db,
): Promise<JobRunDetail | null> {
  assertAdmin(actor);
  const row = await findJobRunById(conn, id);
  if (row === null) return null;
  const item = toListItem(row);
  assertNoPrivateLeak(item.result);
  return {
    ...item,
    heartbeatAt: row.heartbeatAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
