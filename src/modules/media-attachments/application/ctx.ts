import 'server-only';
import type { BaseUseCaseCtx } from '@/shared/utils/useCaseCtx';
import { createBaseUseCaseCtx } from '@/shared/utils/useCaseCtx';

export type MediaCtx = BaseUseCaseCtx;

export function createMediaCtx(input: { requestId: string; isSeedActor?: boolean }): MediaCtx {
  return createBaseUseCaseCtx(input);
}
