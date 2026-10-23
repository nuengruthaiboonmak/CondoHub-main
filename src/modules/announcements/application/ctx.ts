import 'server-only';
import type { BaseUseCaseCtx } from '@/shared/utils/useCaseCtx';
import { createBaseUseCaseCtx } from '@/shared/utils/useCaseCtx';

export type AnnouncementCtx = BaseUseCaseCtx;

export function createAnnouncementCtx(input: {
  requestId: string;
  isSeedActor?: boolean;
}): AnnouncementCtx {
  return createBaseUseCaseCtx(input);
}
