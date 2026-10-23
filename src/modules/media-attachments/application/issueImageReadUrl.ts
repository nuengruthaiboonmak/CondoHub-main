import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { createReadUrl } from '@/shared/storage/presignedUrls';
import { evaluateScopeAcl } from './scopeRegistry';
import { findImageById } from '../infrastructure/imageRepository';
import { canonicalObjectKey } from '../domain/imageVerification';
import type { MediaCtx } from './ctx';

export interface ImageAccessResult {
  url: string;
  expiresAt: string;
}

export async function issueImageReadUrl(
  actor: Actor,
  imageId: string,
  ctx: MediaCtx,
): Promise<ImageAccessResult> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const image = await findImageById(db, imageId);
  if (image === null || image.state !== 'READY') throw new AppError('RESOURCE_NOT_FOUND');
  const verdict = await evaluateScopeAcl(
    image.scope,
    actor,
    {
      imageId: image.id,
      scope: image.scope,
      entityRef:
        image.ownerEntityType === null || image.ownerEntityId === null
          ? null
          : { type: image.ownerEntityType, id: image.ownerEntityId },
    },
    ctx.clock.now(),
  );
  if (!verdict.allowed) {
    if (verdict.reason === 'NOT_PUBLISHED' || verdict.reason === 'ANNOUNCEMENT_HIDDEN') {
      throw new AppError('RESOURCE_NOT_FOUND');
    }
    throw new AppError('ACCESS_DENIED');
  }
  const readKey = canonicalObjectKey(image.objectKey, image.mime);
  const signed = await createReadUrl(readKey);
  return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
}
