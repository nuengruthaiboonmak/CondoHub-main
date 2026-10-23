import type { TurnoverReviewLifecycle } from './turnoverResolve';

export type TurnoverReviewScope = 'PRIVATE' | 'PROJECT_MANAGED';

export type TurnoverQueueAction = 'LIST' | 'DETAIL' | 'COUNT' | 'RESOLVE';

export interface TurnoverVisibilityInput {
  state: TurnoverReviewLifecycle;
  scope: TurnoverReviewScope;
  actorIsSystemAdmin: boolean;
  actorSuspended: boolean;
  actorInS2Snapshot: boolean;
}

export type TurnoverVisibilityVerdict =
  | { allowed: true }
  | { allowed: false; httpStatus: 403 | 404 };

export function evaluateTurnoverVisibility(
  input: TurnoverVisibilityInput,
): TurnoverVisibilityVerdict {
  if (input.actorSuspended) return { allowed: false, httpStatus: 403 };
  if (input.scope === 'PRIVATE') {
    if (!input.actorInS2Snapshot) return { allowed: false, httpStatus: 404 };
    return { allowed: true };
  }
  if (!input.actorIsSystemAdmin) return { allowed: false, httpStatus: 403 };
  return { allowed: true };
}

export function turnoverCountsTowardIndicator(input: {
  state: TurnoverReviewLifecycle;
  visible: boolean;
}): boolean {
  return input.state === 'UNRESOLVED' && input.visible;
}

export function countVisibleUnresolved(input: {
  reviews: { state: TurnoverReviewLifecycle; visible: boolean }[];
}): number {
  return input.reviews.filter((review) => turnoverCountsTowardIndicator(review)).length;
}

export function scopeForManagementMode(
  managementModeAtCreation: string,
): TurnoverReviewScope {
  return managementModeAtCreation === 'PROJECT_MANAGED' ? 'PROJECT_MANAGED' : 'PRIVATE';
}
