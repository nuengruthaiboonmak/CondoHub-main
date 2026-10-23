import 'server-only';
import type { BaseUseCaseCtx } from '@/shared/utils/useCaseCtx';
import { createBaseUseCaseCtx } from '@/shared/utils/useCaseCtx';

export type ChatCtx = BaseUseCaseCtx;

export function createChatCtx(input: {
  requestId: string;
  isSeedActor?: boolean;
}): ChatCtx {
  return createBaseUseCaseCtx(input);
}
