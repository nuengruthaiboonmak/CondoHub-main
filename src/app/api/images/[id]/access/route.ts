import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createMediaCtx,
  issueImageReadUrl,
} from '@/modules/media-attachments/application/index';

export const GET = withApi(
  async (_request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || id === '') {
      throw new AppError('VALIDATION_ERROR', 'The image id is invalid.');
    }
    const mediaCtx = createMediaCtx({ requestId: ctx.requestId });
    return issueImageReadUrl(ctx.actor, id, mediaCtx);
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
