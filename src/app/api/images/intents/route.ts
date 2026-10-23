import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createImageIntent,
  createMediaCtx,
  imageIntentBody,
  parseWithFieldErrors,
} from '@/modules/media-attachments/application/index';

export const POST = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const body = parseWithFieldErrors(imageIntentBody, await request.json());
    const mediaCtx = createMediaCtx({ requestId: ctx.requestId });
    return createImageIntent(
      ctx.actor,
      {
        scope: body.scope,
        entityRef: { type: body.entityRef.type, id: body.entityRef.id },
        contentType: body.contentType,
        fileName: body.fileName,
      },
      mediaCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.imageIntent ?? { capacity: 30, windowMs: 3_600_000 } },
);
