import 'server-only';
import type { BaseUseCaseCtx } from '@/shared/utils/useCaseCtx';
import { createBaseUseCaseCtx } from '@/shared/utils/useCaseCtx';

export type PropertyCtx = BaseUseCaseCtx;

export function createPropertyCtx(input: { requestId: string; isSeedActor?: boolean }): PropertyCtx {
  return createBaseUseCaseCtx(input);
}
