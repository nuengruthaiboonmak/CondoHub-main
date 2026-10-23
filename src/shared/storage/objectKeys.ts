import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/errors';
import type { AllowedImageContentType } from './presignedUrls';

export const IMAGE_SCOPES = [
  'PAYMENT_SLIP',
  'PAYMENT_QR',
  'MAINTENANCE',
  'ANNOUNCEMENT',
  'CHAT',
] as const;

export type ImageScope = (typeof IMAGE_SCOPES)[number];

const SCOPE_PREFIXES: Record<ImageScope, string> = {
  PAYMENT_SLIP: 'payment-slip',
  PAYMENT_QR: 'payment-qr',
  MAINTENANCE: 'maintenance',
  ANNOUNCEMENT: 'announcement',
  CHAT: 'chat',
};

const MIME_EXTENSIONS: Record<AllowedImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function isImageScope(value: unknown): value is ImageScope {
  return typeof value === 'string' && (IMAGE_SCOPES as readonly string[]).includes(value);
}

export function buildObjectKey(scope: ImageScope, verifiedMime: AllowedImageContentType): string {
  if (!isImageScope(scope)) {
    throw new AppError('VALIDATION_ERROR', 'The image scope is invalid.');
  }
  const extension = MIME_EXTENSIONS[verifiedMime];
  if (extension === undefined) {
    throw new AppError('FILE_NOT_ALLOWED', undefined);
  }
  return `${SCOPE_PREFIXES[scope]}/${randomUUID()}.${extension}`;
}

export function buildE2EObjectKey(runId: string, scope: ImageScope, fileName: string): string {
  if (!isImageScope(scope)) {
    throw new AppError('VALIDATION_ERROR', 'The image scope is invalid.');
  }
  const safeRunId = runId.replace(/[^a-zA-Z0-9-]/g, '');
  const safeFile = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
  if (safeRunId === '' || safeFile === '') {
    throw new AppError('VALIDATION_ERROR', 'The E2E object key parts are invalid.');
  }
  return `e2e/${safeRunId}/${SCOPE_PREFIXES[scope]}/${safeFile}`;
}
