import type { ImageState } from './imageState';

export const ORPHAN_PENDING_GRACE_MS = 30 * 60 * 1000;

export const ORPHAN_READY_GRACE_MS = 24 * 60 * 60 * 1000;

export interface OrphanCandidate {
  state: ImageState;
  ownerEntityType: string | null;
  createdAt: Date;
  objectKey: string;
}

export function isOrphanSweepable(candidate: OrphanCandidate, now: Date): boolean {
  if (candidate.ownerEntityType !== null) return false;
  if (candidate.state === 'PENDING' || candidate.state === 'UPLOADED') {
    return now.getTime() - candidate.createdAt.getTime() > ORPHAN_PENDING_GRACE_MS;
  }
  if (candidate.state === 'READY') {
    return now.getTime() - candidate.createdAt.getTime() > ORPHAN_READY_GRACE_MS;
  }
  return false;
}

export function isE2ESkipYoung(objectKey: string, createdAt: Date, now: Date): boolean {
  if (!objectKey.startsWith('e2e/')) return false;
  return now.getTime() - createdAt.getTime() < ORPHAN_READY_GRACE_MS;
}
