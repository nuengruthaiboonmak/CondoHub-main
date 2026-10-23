import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import type { Tx } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import type { ImageScope } from '@/shared/storage/objectKeys';
import { attachImages, listImagesByIdsForUpdate } from '../infrastructure/imageRepository';
import { validateAttachable } from '../domain/attachPolicy';

export interface CommitAttachmentsOptions {
  scope: ImageScope;
  entityRef: { type: string; id: string };
  imageIds: string[];
  maxCount: number;
  at: Date;
}

export async function commitAttachments(
  tx: Tx,
  actor: Actor,
  opts: CommitAttachmentsOptions,
): Promise<void> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const uniqueIds = [...new Set(opts.imageIds)];
  if (uniqueIds.length === 0) return;
  const images = await listImagesByIdsForUpdate(tx, uniqueIds);
  const failure = validateAttachable(opts.imageIds, images, {
    scope: opts.scope,
    entityRef: opts.entityRef,
    ownerUserId: actor.userId,
    maxCount: opts.maxCount,
  });
  if (failure !== null) throw new AppError('VALIDATION_ERROR', failure);
  await attachImages(tx, uniqueIds, opts.entityRef, opts.at);
}
