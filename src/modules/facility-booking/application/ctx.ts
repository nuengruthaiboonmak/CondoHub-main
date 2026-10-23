import 'server-only';
import type { BaseUseCaseCtx } from '@/shared/utils/useCaseCtx';
import { createBaseUseCaseCtx } from '@/shared/utils/useCaseCtx';

export type BookingCtx = BaseUseCaseCtx;

export function createBookingCtx(input: {
  requestId: string;
  isSeedActor?: boolean;
}): BookingCtx {
  return createBaseUseCaseCtx(input);
}
