import 'server-only';
import type { BaseUseCaseCtx } from '@/shared/utils/useCaseCtx';
import { createBaseUseCaseCtx } from '@/shared/utils/useCaseCtx';

export type MaintenanceCtx = BaseUseCaseCtx;

export function createMaintenanceCtx(input: {
  requestId: string;
  isSeedActor?: boolean;
}): MaintenanceCtx {
  return createBaseUseCaseCtx(input);
}
