import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/shared/db/transaction';
import { jobRun, type JobName, type JobRunState } from '@/shared/db/schema/jobs';

export interface JobRunRecord {
  id: string;
  jobName: string;
  businessKey: string;
  state: JobRunState;
  payload: unknown;
  result: unknown;
  heartbeatAt: Date;
  startedAt: Date;
  finishedAt: Date | null;
  attempt: number;
  triggerSource: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: typeof jobRun.$inferSelect): JobRunRecord {
  return {
    id: row.id,
    jobName: row.jobName,
    businessKey: row.businessKey,
    state: row.state,
    payload: row.payload,
    result: row.result,
    heartbeatAt: row.heartbeatAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    attempt: row.attempt,
    triggerSource: row.triggerSource,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listJobRuns(
  conn: Db,
  input: { jobName?: JobName | undefined; state?: JobRunState | undefined; limit: number; offset: number },
): Promise<{ rows: JobRunRecord[]; total: number }> {
  const conditions = [];
  if (input.jobName !== undefined) conditions.push(eq(jobRun.jobName, input.jobName));
  if (input.state !== undefined) conditions.push(eq(jobRun.state, input.state));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await conn
    .select()
    .from(jobRun)
    .where(where)
    .orderBy(desc(jobRun.startedAt), desc(jobRun.id))
    .limit(input.limit)
    .offset(input.offset);
  const counted = await conn
    .select({ count: sql<number>`count(*)` })
    .from(jobRun)
    .where(where);
  return { rows: rows.map(toRecord), total: Number(counted[0]?.count ?? 0) };
}

export async function findJobRunById(conn: Db, id: string): Promise<JobRunRecord | null> {
  const rows = await conn.select().from(jobRun).where(eq(jobRun.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function listDoneGenerateKeys(conn: Db): Promise<string[]> {
  const rows = await conn
    .select({ businessKey: jobRun.businessKey })
    .from(jobRun)
    .where(and(eq(jobRun.jobName, 'generate-invoices'), eq(jobRun.state, 'DONE')));
  return rows.map((row) => row.businessKey);
}
