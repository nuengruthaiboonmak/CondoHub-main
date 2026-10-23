import 'server-only';
import type { BaseUseCaseCtx } from '@/shared/utils/useCaseCtx';
import { createBaseUseCaseCtx } from '@/shared/utils/useCaseCtx';
import type { TempPasswordGenerator } from '@/modules/identity-access/infrastructure/tempPassword';
import { tempPasswordGenerator } from '@/modules/identity-access/infrastructure/tempPassword';

export interface IdentityCtx extends BaseUseCaseCtx {
  tempPasswords: TempPasswordGenerator;
}

export function createIdentityCtx(input: { requestId: string; isSeedActor?: boolean }): IdentityCtx {
  return {
    ...createBaseUseCaseCtx(input),
    tempPasswords: tempPasswordGenerator,
  };
}
