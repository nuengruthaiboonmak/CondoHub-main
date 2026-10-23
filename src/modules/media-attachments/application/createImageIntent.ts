import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { IMAGE_BYTE_CAPS, IMAGE_COUNT_CAPS, type ImageCountAction } from '@/config/imageLimits';
import { buildObjectKey, type ImageScope } from '@/shared/storage/objectKeys';
import { createUploadUrl } from '@/shared/storage/presignedUrls';
import { writeAudit } from '@/shared/observability/audit';
import { evaluateScopeAcl } from './scopeRegistry';
import { countUserOpenIntents, insertImageIntent } from '../infrastructure/imageRepository';
import { precheckCountAllows } from '../domain/imageVerification';
import type { MediaCtx } from './ctx';

export const IMAGE_INTENT_TTL_MS = 30 * 60 * 1000;

const SCOPE_COUNT_ACTION: Record<ImageScope, ImageCountAction> = {
  PAYMENT_SLIP: 'SUBMIT_PAYMENT',
  PAYMENT_QR: 'SAVE_PAYMENT_INSTRUCTION',
  MAINTENANCE: 'CREATE_TICKET',
  ANNOUNCEMENT: 'PUBLISH_ANNOUNCEMENT',
  CHAT: 'SEND_CHAT_MESSAGE',
};

export interface CreateImageIntentInput {
  scope: ImageScope;
  entityRef: { type: string; id: string | null };
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  fileName: string;
}

export interface CreateImageIntentResult {
  imageId: string;
  uploadUrl: string;
  expiresAt: string;
  countCheck: { action: ImageCountAction; used: number; max: number };
}

export async function createImageIntent(
  actor: Actor,
  input: CreateImageIntentInput,
  ctx: MediaCtx,
): Promise<CreateImageIntentResult> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  if (input.scope === 'ANNOUNCEMENT' && !actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  const now = ctx.clock.now();
  const verdict = await evaluateScopeAcl(
    input.scope,
    actor,
    {
      scope: input.scope,
      entityRef: input.entityRef.id === null ? null : { type: input.entityRef.type, id: input.entityRef.id },
    },
    now,
  );
  if (!verdict.allowed) {
    if (verdict.reason === 'NOT_PUBLISHED' || verdict.reason === 'ANNOUNCEMENT_HIDDEN') {
      throw new AppError('RESOURCE_NOT_FOUND');
    }
    throw new AppError('ACCESS_DENIED');
  }
  const action = SCOPE_COUNT_ACTION[input.scope];
  const max = IMAGE_COUNT_CAPS[action].max;
  const used = await countUserOpenIntents(db, { uploadedBy: actor.userId, scope: input.scope, now });
  if (!precheckCountAllows(used, max)) {
    throw new AppError('VALIDATION_ERROR', `Too many images. The maximum is ${max}.`);
  }
  const objectKey = buildObjectKey(input.scope, input.contentType);
  const upload = await createUploadUrl(objectKey, input.contentType, IMAGE_BYTE_CAPS[input.scope]);
  const expiresAt = new Date(now.getTime() + IMAGE_INTENT_TTL_MS);
  const created = await db.transaction(async (tx) => {
    const intent = await insertImageIntent(tx, {
      uploadedBy: actor.userId,
      objectKey,
      scope: input.scope,
      mime: input.contentType,
      expiresAt,
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'image.intent.created',
      resourceType: 'image_attachment',
      resourceId: intent.id,
      requestId: ctx.requestId,
      after: { scope: input.scope },
    });
    return intent;
  });
  return {
    imageId: created.id,
    uploadUrl: upload.url,
    expiresAt: created.expiresAt?.toISOString() ?? expiresAt.toISOString(),
    countCheck: { action, used, max },
  };
}
