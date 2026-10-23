import { and, eq, lt, or, sql } from 'drizzle-orm';
import type { Db } from './transaction';
import { jobRun, type JobName } from './schema/jobs';
import type { AuditJson } from '../observability/audit';

export const JOB_LEASE_STALE_MS = 10 * 60 * 1000;
export const JOB_LEASE_HEARTBEAT_MS = 30 * 1000;

export const JOB_LEASE_SKELETON_NOTE =
  'SKELETON: final implementation and concurrency proof owned by billing-S1' as const;

export type AcquireResult =
  | { acquired: true; attempt: number }
  | { acquired: false; reason: 'ALREADY_RUNNING' };

export interface JobOutcome {
  state: 'DONE' | 'ERROR';
  result?: AuditJson;
  error?: { code: string; message: string };
}

export async function acquireJobLease(
  db: Db,
  jobName: JobName,
  businessKey: string,
  triggerSource: string,
): Promise<AcquireResult> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - JOB_LEASE_STALE_MS);
  const inserted = await db
    .insert(jobRun)
    .values({
      jobName,
      businessKey,
      state: 'RUNNING',
      heartbeatAt: now,
      startedAt: now,
      attempt: 1,
      triggerSource,
    })
    .onConflictDoNothing({ target: [jobRun.jobName, jobRun.businessKey] })
    .returning({ attempt: jobRun.attempt });
  if (inserted.length > 0 && inserted[0] !== undefined) {
    return { acquired: true, attempt: inserted[0].attempt };
  }
  const adopted = await db
    .update(jobRun)
    .set({
      state: 'RUNNING',
      heartbeatAt: now,
      startedAt: now,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      attempt: sql`${jobRun.attempt} + 1`,
      triggerSource,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobRun.jobName, jobName),
        eq(jobRun.businessKey, businessKey),
        or(
          sql`${jobRun.state} IN ('DONE', 'ERROR')`,
          and(eq(jobRun.state, 'RUNNING'), lt(jobRun.heartbeatAt, staleBefore)),
        ),
      ),
    )
    .returning({ attempt: jobRun.attempt });
  if (adopted.length > 0 && adopted[0] !== undefined) {
    return { acquired: true, attempt: adopted[0].attempt };
  }
  return { acquired: false, reason: 'ALREADY_RUNNING' };
}

export async function heartbeatJobLease(
  db: Db,
  jobName: JobName,
  businessKey: string,
  heldAttempt: number,
): Promise<void> {
  const now = new Date();
  const updated = await db
    .update(jobRun)
    .set({ heartbeatAt: now, updatedAt: now })
    .where(
      and(
        eq(jobRun.jobName, jobName),
        eq(jobRun.businessKey, businessKey),
        eq(jobRun.state, 'RUNNING'),
        eq(jobRun.attempt, heldAttempt),
      ),
    )
    .returning({ id: jobRun.id });
  if (updated.length === 0) {
    throw new Error(`Job lease lost for ${jobName} ${businessKey} attempt ${heldAttempt}`);
  }
}

export async function finishJobLease(
  db: Db,
  jobName: JobName,
  businessKey: string,
  heldAttempt: number,
  outcome: JobOutcome,
): Promise<void> {
  const now = new Date();
  await db
    .update(jobRun)
    .set({
      state: outcome.state,
      result: (outcome.result ?? null) as unknown as Record<string, unknown> | null,
      finishedAt: now,
      errorCode: outcome.error?.code ?? null,
      errorMessage: outcome.error?.message ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobRun.jobName, jobName),
        eq(jobRun.businessKey, businessKey),
        eq(jobRun.attempt, heldAttempt),
      ),
    );
}
