import 'server-only';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { JOB_LEASE_HEARTBEAT_MS } from '@/shared/db/jobLease';
import { childLogger } from '@/shared/observability/logger';
import type { Actor } from '@/shared/auth/actor';
import { PROJECT_TIMEZONE } from '@/config/project';
import { listDoneGenerateKeys } from '../infrastructure/jobRunRepository';
import {
  currentYearMonth,
  parseCycleRangeEnd,
  resolveGenerationWindow,
  type GenerationWindow,
} from '../domain/billingWindow';
import {
  emptyJobCounts,
  redactJobResult,
  type JobCounts,
  type RedactedJobResult,
} from '../domain/jobRedaction';
import {
  generateInvoicesForCycle,
  type GenerateInvoicesDeps,
} from './generateInvoices';
import type { BillingCtx } from './ctx';

export interface GenerateJobResult {
  counts: JobCounts;
  redacted: RedactedJobResult;
  cycles: string[];
  businessKey: string;
  caughtUp: boolean;
  nextFromCycle?: string | undefined;
}

export interface GenerateJobDeps extends GenerateInvoicesDeps {
  database?: Db;
  heartbeat?: () => Promise<void>;
}

function latestDoneCycle(keys: string[]): string | null {
  let latest: string | null = null;
  for (const key of keys) {
    const end = parseCycleRangeEnd(key);
    if (latest === null || end > latest) latest = end;
  }
  return latest;
}

function heartbeatDue(lastHeartbeatAt: number): boolean {
  return Date.now() - lastHeartbeatAt >= JOB_LEASE_HEARTBEAT_MS;
}

export async function resolveGenerateWindow(
  input: { fromCycle?: string | undefined; toCycle?: string | undefined },
  now: Date,
  database: Db = db,
): Promise<GenerationWindow> {
  const current = currentYearMonth(now, PROJECT_TIMEZONE);
  const doneKeys = await listDoneGenerateKeys(database);
  return resolveGenerationWindow({
    currentYm: current,
    lastDoneCycle: latestDoneCycle(doneKeys),
    ...(input.fromCycle !== undefined ? { fromCycle: input.fromCycle } : {}),
    ...(input.toCycle !== undefined ? { toCycle: input.toCycle } : {}),
  });
}

export async function latestDoneGenerateCycle(database: Db = db): Promise<string | null> {
  return latestDoneCycle(await listDoneGenerateKeys(database));
}

export async function runGenerateInvoices(
  actor: Actor,
  input: { fromCycle?: string | undefined; toCycle?: string | undefined },
  ctx: BillingCtx,
  deps: GenerateJobDeps = {},
): Promise<GenerateJobResult> {
  const database = deps.database ?? db;
  const now = ctx.clock.now();
  const window = await resolveGenerateWindow(
    {
      ...(input.fromCycle !== undefined ? { fromCycle: input.fromCycle } : {}),
      ...(input.toCycle !== undefined ? { toCycle: input.toCycle } : {}),
    },
    now,
    database,
  );
  const counts = emptyJobCounts(window.caughtUp);
  if (window.nextFromCycle !== undefined) counts.nextFromCycle = window.nextFromCycle;
  let lastHeartbeatAt = Date.now();
  const log = childLogger({ requestId: ctx.requestId });
  for (const cycle of window.cycles) {
    if (deps.heartbeat !== undefined && heartbeatDue(lastHeartbeatAt)) {
      await deps.heartbeat();
      lastHeartbeatAt = Date.now();
    }
    const cycleCounts = await generateInvoicesForCycle(actor, cycle, ctx, deps);
    counts.created += cycleCounts.created;
    counts.skipped += cycleCounts.skipped;
    counts.reviewRequired += cycleCounts.reviewRequired;
    counts.privateRentCreated += cycleCounts.privateRentCreated;
    counts.privateRentSkipped += cycleCounts.privateRentSkipped;
    counts.privateReviews += cycleCounts.privateReviews;
    counts.cycleErrors += cycleCounts.cycleErrors.length;
    if (cycleCounts.cycleErrors.length > 0) {
      log.warn(
        {
          job: 'generate-invoices',
          cycle,
          errors: cycleCounts.cycleErrors.map((entry) => ({
            roomId: entry.roomId,
            reason: entry.reason,
          })),
        },
        'generate-invoices cycle errors',
      );
    }
  }
  log.info(
    {
      job: 'generate-invoices',
      businessKey: window.businessKey,
      created: counts.created,
      skipped: counts.skipped,
      reviewRequired: counts.reviewRequired,
      caughtUp: window.caughtUp,
    },
    'generate-invoices done',
  );
  const result: GenerateJobResult = {
    counts,
    redacted: redactJobResult(counts),
    cycles: window.cycles,
    businessKey: window.businessKey,
    caughtUp: window.caughtUp,
  };
  if (window.nextFromCycle !== undefined) result.nextFromCycle = window.nextFromCycle;
  return result;
}
