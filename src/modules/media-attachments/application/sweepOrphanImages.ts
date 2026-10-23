import 'server-only';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { JOB_LEASE_HEARTBEAT_MS } from '@/shared/db/jobLease';
import { childLogger } from '@/shared/observability/logger';
import { deleteObject } from '@/shared/storage/presignedUrls';
import {
  canonicalObjectKey,
} from '../domain/imageVerification';
import {
  ORPHAN_PENDING_GRACE_MS,
  ORPHAN_READY_GRACE_MS,
  isE2ESkipYoung,
} from '../domain/orphanPolicy';
import {
  listOrphanSweepCandidates,
  markImageOrphaned,
  type ImageAttachmentRecord,
} from '../infrastructure/imageRepository';
import type { MediaCtx } from './ctx';

export const SWEEP_ORPHANS_BATCH_SIZE = 100;

export const SWEEP_ORPHANS_MAX_ROWS = 500;

export interface SweepOrphansResult {
  scanned: number;
  transitioned: number;
  skippedYoung: number;
  skippedRaced: number;
  s3Deleted: number;
  s3Failures: number;
  caughtUp: boolean;
}

export interface SweepOrphansDeps {
  database?: Db;
  heartbeat?: () => Promise<void>;
  removeObject?: (objectKey: string) => Promise<void>;
}

function defaultRemoveObject(objectKey: string): Promise<void> {
  return deleteObject(objectKey);
}

async function removeRowObjects(
  row: ImageAttachmentRecord,
  removeObject: (objectKey: string) => Promise<void>,
  requestId: string,
): Promise<{ deleted: number; failures: number }> {
  const keys = row.mimeVerified
    ? [...new Set([row.objectKey, canonicalObjectKey(row.objectKey, row.mime)])]
    : [row.objectKey];
  let deleted = 0;
  let failures = 0;
  for (const key of keys) {
    try {
      await removeObject(key);
      deleted += 1;
    } catch (error) {
      failures += 1;
      childLogger({ requestId }).warn(
        { objectKey: key, error: String(error) },
        'orphan sweep object delete failed',
      );
    }
  }
  return { deleted, failures };
}

export async function sweepOrphanImages(
  ctx: MediaCtx,
  deps?: SweepOrphansDeps,
): Promise<SweepOrphansResult> {
  const database = deps?.database ?? db;
  const removeObject = deps?.removeObject ?? defaultRemoveObject;
  const heartbeat = deps?.heartbeat;
  const now = ctx.clock.now();
  const pendingBefore = new Date(now.getTime() - ORPHAN_PENDING_GRACE_MS);
  const readyBefore = new Date(now.getTime() - ORPHAN_READY_GRACE_MS);
  const result: SweepOrphansResult = {
    scanned: 0,
    transitioned: 0,
    skippedYoung: 0,
    skippedRaced: 0,
    s3Deleted: 0,
    s3Failures: 0,
    caughtUp: true,
  };
  let lastHeartbeatAt = Date.now();
  for (;;) {
    if (heartbeat !== undefined && Date.now() - lastHeartbeatAt >= JOB_LEASE_HEARTBEAT_MS) {
      await heartbeat();
      lastHeartbeatAt = Date.now();
    }
    const batch = await listOrphanSweepCandidates(database, {
      pendingBefore,
      readyBefore,
      limit: SWEEP_ORPHANS_BATCH_SIZE,
    });
    if (batch.length === 0) return result;
    for (const row of batch) {
      result.scanned += 1;
      if (isE2ESkipYoung(row.objectKey, row.createdAt, now)) {
        result.skippedYoung += 1;
        continue;
      }
      const reason = row.state === 'READY' ? 'READY_UNATTACHED_24H' : 'INTENT_STALE_30M';
      const transitioned = await database.transaction(async (tx) => {
        return markImageOrphaned(tx, row.id, { pendingBefore, readyBefore, reason });
      });
      if (!transitioned) {
        result.skippedRaced += 1;
        continue;
      }
      result.transitioned += 1;
      const cleanup = await removeRowObjects(row, removeObject, ctx.requestId);
      result.s3Deleted += cleanup.deleted;
      result.s3Failures += cleanup.failures;
      if (result.scanned >= SWEEP_ORPHANS_MAX_ROWS) {
        result.caughtUp = false;
        return result;
      }
    }
    if (batch.length < SWEEP_ORPHANS_BATCH_SIZE) return result;
  }
}
