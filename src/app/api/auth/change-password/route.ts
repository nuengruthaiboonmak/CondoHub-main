import 'server-only';
import { z } from 'zod';
import { withApi } from '@/shared/auth/withApi';
import { requireActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { createIdentityCtx, changePassword } from '@/modules/identity-access/application/index';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/modules/identity-access/domain/passwordPolicy';

const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export const POST = withApi(
  async (request, ctx) => {
    const parsed = changePasswordBody.safeParse(await request.json());
    if (!parsed.success) throw new AppError('VALIDATION_ERROR');
    const actor = requireActor(ctx.actor);
    if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
    const identityCtx = createIdentityCtx({ requestId: ctx.requestId });
    return changePassword(ctx.actor, parsed.data, identityCtx);
  },
  {
    allowFirstLogin: true,
    rateLimit: RATE_LIMIT_PRESETS.passwordReset ?? { capacity: 10, windowMs: 3_600_000 },
  },
);
