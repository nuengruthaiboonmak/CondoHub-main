import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import {
  insertAnnouncement,
  updateAnnouncement,
} from '../infrastructure/announcementRepository';
import type { AnnouncementCtx } from './ctx';

export interface SeedAnnouncementInput {
  title: string;
  body: string;
  publishAt: Date | null;
  hiddenAt?: Date | null | undefined;
  authorId: string | null;
}

export async function seedAnnouncement(
  actor: Actor,
  input: SeedAnnouncementInput,
  ctx: AnnouncementCtx,
): Promise<{ announcementId: string }> {
  if (!ctx.isSeedActor) throw new AppError('ACCESS_DENIED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  try {
    return await db.transaction(async (tx) => {
      const created = await insertAnnouncement(tx, {
        authorId: input.authorId,
        title: input.title,
        body: input.body,
        publishAt: input.publishAt,
      });
      if (input.hiddenAt !== undefined && input.hiddenAt !== null) {
        await updateAnnouncement(tx, created.id, { hiddenAt: input.hiddenAt });
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'announcement.seed.created',
        resourceType: 'announcement',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: {
          title: input.title,
          publishAt: input.publishAt?.toISOString() ?? null,
          hiddenAt: input.hiddenAt?.toISOString() ?? null,
        },
      });
      return { announcementId: created.id };
    });
  } catch (error) {
    throw mapPgError(error);
  }
}
