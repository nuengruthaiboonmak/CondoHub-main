import 'server-only';
import type { BaseUseCaseCtx } from '@/shared/utils/useCaseCtx';
import { createBaseUseCaseCtx } from '@/shared/utils/useCaseCtx';

export type BillingCtx = BaseUseCaseCtx;

export function createBillingCtx(input: {
  requestId: string;
  isSeedActor?: boolean;
}): BillingCtx {
  return createBaseUseCaseCtx(input);
}
