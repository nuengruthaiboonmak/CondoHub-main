import 'server-only';
import { createHash } from 'node:crypto';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { childLogger } from '@/shared/observability/logger';
import { IMAGE_BYTE_CAPS } from '@/config/imageLimits';
import {
  deleteObject,
  getObjectBytes,
  headObject,
  putObjectBytes,
} from '@/shared/storage/presignedUrls';
import { writeAudit } from '@/shared/observability/audit';
import {
  findImageById,
  markImageReady,
  markImageRejected,
} from '../infrastructure/imageRepository';
import { verifyAndStripImage } from '../infrastructure/imageVerification';
import {
  canonicalObjectKey,
  detectMimeFromMagic,
  exceedsByteCap,
} from '../domain/imageVerification';
import { canCompleteFrom, isIntentExpired, isTerminalImageState } from '../domain/imageState';
import type { MediaCtx } from './ctx';

export interface CompleteImageResult {
  imageId: string;
  state: 'READY';
  scope: string;
  byteSize: number;
  mimeVerified: string;
  width: number | null;
  height: number | null;
}

export async function completeImageUpload(
  actor: Actor,
  imageId: string,
  ctx: MediaCtx,
): Promise<CompleteImageResult> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const now = ctx.clock.now();
  const image = await findImageById(db, imageId);
  if (image === null || image.uploadedBy !== actor.userId) {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  if (isTerminalImageState(image.state)) throw new AppError('VALIDATION_ERROR', 'This upload is already closed.');
  if (!canCompleteFrom(image.state)) {
    throw new AppError('VALIDATION_ERROR', 'This upload cannot be completed.');
  }
  if (isIntentExpired(image.expiresAt, now)) {
    throw new AppError('VALIDATION_ERROR', 'This upload intent has expired.');
  }
  const head = await headObject(image.objectKey);
  if (head === null) {
    await rejectInTx(actor.userId, imageId, 'UPLOAD_MISSING', ctx.requestId);
    throw new AppError('VALIDATION_ERROR', 'The uploaded file was not found. Please upload again.');
  }
  if (exceedsByteCap(head.sizeBytes, IMAGE_BYTE_CAPS[image.scope])) {
    await rejectInTx(actor.userId, imageId, 'BYTE_CAP_EXCEEDED', ctx.requestId);
    await removeObjectBestEffort(image.objectKey, ctx.requestId);
    throw new AppError(
      'FILE_TOO_LARGE',
      `The image exceeds the ${Math.round(IMAGE_BYTE_CAPS[image.scope] / 1_000_000)} MB limit.`,
    );
  }
  const stored = await getObjectBytes(image.objectKey);
  if (stored === null) {
    await rejectInTx(actor.userId, imageId, 'UPLOAD_MISSING', ctx.requestId);
    throw new AppError('VALIDATION_ERROR', 'The uploaded file was not found. Please upload again.');
  }
  if (exceedsByteCap(stored.length, IMAGE_BYTE_CAPS[image.scope])) {
    await rejectInTx(actor.userId, imageId, 'BYTE_CAP_EXCEEDED', ctx.requestId);
    await removeObjectBestEffort(image.objectKey, ctx.requestId);
    throw new AppError(
      'FILE_TOO_LARGE',
      `The image exceeds the ${Math.round(IMAGE_BYTE_CAPS[image.scope] / 1_000_000)} MB limit.`,
    );
  }
  const magicMime = detectMimeFromMagic(stored);
  if (magicMime === null) {
    await rejectInTx(actor.userId, imageId, 'TYPE_MISMATCH', ctx.requestId);
    await removeObjectBestEffort(image.objectKey, ctx.requestId);
    throw new AppError(
      'FILE_NOT_ALLOWED',
      'This file is not a supported image. Supported types: JPEG, PNG, WebP.',
    );
  }
  const verified = await verifyAndStripImage(stored, IMAGE_BYTE_CAPS[image.scope]);
  if (verified === 'UNREADABLE' || verified === 'UNSUPPORTED') {
    await rejectInTx(actor.userId, imageId, 'DECODE_FAILED', ctx.requestId);
    await removeObjectBestEffort(image.objectKey, ctx.requestId);
    throw new AppError('VALIDATION_ERROR', 'This image cannot be processed. Please choose another file.');
  }
  const strippedKey = canonicalObjectKey(image.objectKey, verified.mime);
  const sha256 = createHash('sha256').update(verified.bytes).digest('hex');
  await putObjectBytes(strippedKey, verified.bytes, verified.mime);
  if (strippedKey !== image.objectKey) {
    await removeObjectBestEffort(image.objectKey, ctx.requestId);
  }
  const ready = await db.transaction(async (tx) => {
    const updated = await markImageReady(tx, imageId, {
      objectKey: strippedKey,
      sizeBytes: verified.bytes.length,
      mimeVerified: verified.mime,
      width: verified.width,
      height: verified.height,
      sha256,
    });
    if (updated === null) throw new AppError('RESOURCE_NOT_FOUND');
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'image.upload.completed',
      resourceType: 'image_attachment',
      resourceId: imageId,
      requestId: ctx.requestId,
      after: { scope: image.scope, byteSize: verified.bytes.length, mimeVerified: verified.mime },
    });
    return updated;
  });
  return {
    imageId: ready.id,
    state: 'READY',
    scope: ready.scope,
    byteSize: ready.sizeBytes,
    mimeVerified: verified.mime,
    width: ready.width,
    height: ready.height,
  };
}

async function removeObjectBestEffort(objectKey: string, requestId: string): Promise<void> {
  try {
    await deleteObject(objectKey);
  } catch (error) {
    childLogger({ requestId }).warn({ objectKey, error: String(error) }, 'image cleanup delete failed');
  }
}

async function rejectInTx(
  actorId: string,
  imageId: string,
  reason: string,
  requestId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await markImageRejected(tx, imageId, reason);
    await writeAudit(tx, {
      actorId,
      action: 'image.upload.rejected',
      resourceType: 'image_attachment',
      resourceId: imageId,
      requestId,
      after: { reason },
    });
  });
}
