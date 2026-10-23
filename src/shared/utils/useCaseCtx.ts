import type { Clock } from './clock';
import { systemClock } from './clock';

export interface BaseUseCaseCtx {
  clock: Clock;
  requestId: string;
  isSeedActor: boolean;
}

export function createBaseUseCaseCtx(input: {
  requestId: string;
  isSeedActor?: boolean;
}): BaseUseCaseCtx {
  return {
    clock: systemClock,
    requestId: input.requestId,
    isSeedActor: input.isSeedActor ?? false,
  };
}
