import 'server-only';
import { createHash } from 'node:crypto';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import type { ImageScope } from '@/shared/storage/objectKeys';
import { buildE2EObjectKey } from '@/shared/storage/objectKeys';
import { putObjectBytes } from '@/shared/storage/presignedUrls';
import { insertSeedImage, markImageReady } from '../infrastructure/imageRepository';
import type { MediaCtx } from './ctx';

export interface SeedStaleImageInput {
  runId: string;
  fileName: string;
  scope: ImageScope;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Buffer;
  width: number | null;
  height: number | null;
  createdAt: Date;
  ready: boolean;
}

export async function seedStaleImage(
  actor: Actor,
  input: SeedStaleImageInput,
  ctx: MediaCtx,
): Promise<{ imageId: string; objectKey: string }> {
  if (!ctx.isSeedActor) throw new AppError('ACCESS_DENIED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  const objectKey = buildE2EObjectKey(input.runId, input.scope, input.fileName);
  await putObjectBytes(objectKey, input.bytes, input.mime);
  try {
    const created = await db.transaction(async (tx) => {
      const intent = await insertSeedImage(tx, {
        uploadedBy: actor.userId,
        objectKey,
        scope: input.scope,
        mime: input.mime,
        createdAt: input.createdAt,
        expiresAt: input.ready ? null : new Date(input.createdAt.getTime() + 30 * 60 * 1000),
      });
      if (!input.ready) {
        await writeAudit(tx, {
          actorId: actor.userId,
          action: 'image.seed.stale',
          resourceType: 'image_attachment',
          resourceId: intent.id,
          requestId: ctx.requestId,
          after: { scope: input.scope, state: 'PENDING', runId: input.runId },
        });
        return intent;
      }
      const sha256 = createHash('sha256').update(input.bytes).digest('hex');
      const ready = await markImageReady(tx, intent.id, {
        objectKey,
        sizeBytes: input.bytes.length,
        mimeVerified: input.mime,
        width: input.width,
        height: input.height,
        sha256,
      });
      if (ready === null) throw new AppError('RESOURCE_NOT_FOUND');
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'image.seed.stale',
        resourceType: 'image_attachment',
        resourceId: ready.id,
        requestId: ctx.requestId,
        after: { scope: input.scope, state: 'READY', runId: input.runId },
      });
      return ready;
    });
    return { imageId: created.id, objectKey };
  } catch (error) {
    throw mapPgError(error);
  }
}
