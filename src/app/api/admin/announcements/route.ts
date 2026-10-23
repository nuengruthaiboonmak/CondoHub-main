import 'server-only';
import { revalidatePath } from 'next/cache';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  announcementCreateBody,
  createAnnouncement,
  createAnnouncementCtx,
  parseWithFieldErrors,
} from '@/modules/announcements/application/index';

export const POST = withApi(
  async (request, ctx) => {
    requireAdmin(ctx.actor);
    const body = parseWithFieldErrors(announcementCreateBody, await request.json());
    const announcementCtx = createAnnouncementCtx({ requestId: ctx.requestId });
    const created = await createAnnouncement(
      ctx.actor,
      {
        title: body.title,
        body: body.body,
        publishAt: body.publishAt ?? null,
        imageIds: body.imageIds,
      },
      announcementCtx,
    );
    revalidatePath('/announcements');
    revalidatePath(`/announcements/${created.id}`);
    return {
      id: created.id,
      title: created.title,
      body: created.body,
      publishAt: created.publishAt,
      hiddenAt: created.hiddenAt,
      editedAt: created.editedAt,
      revision: created.revision,
      status: created.status,
      images: created.images,
    };
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
