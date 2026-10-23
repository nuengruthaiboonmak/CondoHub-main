import { AppError } from '@/shared/utils/errors';

export const CHAT_TEXT_MAX_LENGTH = 20000;

export interface SendMessageContent {
  text: string | null;
  imageId: string | null;
}

export interface ValidatedMessageContent {
  text: string | null;
  imageId: string | null;
  type: 'TEXT' | 'IMAGE';
}

export interface SenderSnapshotInput {
  name: string;
  isAdmin: boolean;
}

export interface SenderSnapshot {
  name: string;
  isAdmin: boolean;
}

export function buildSenderSnapshot(input: SenderSnapshotInput): SenderSnapshot {
  return { name: input.name, isAdmin: input.isAdmin };
}

export function parseSenderSnapshot(value: unknown): SenderSnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('INTERNAL_ERROR', 'The sender snapshot is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name === '' || typeof record.isAdmin !== 'boolean') {
    throw new AppError('INTERNAL_ERROR', 'The sender snapshot is invalid.');
  }
  return { name: record.name, isAdmin: record.isAdmin };
}

export function assertMessageContentValid(content: SendMessageContent): ValidatedMessageContent {
  const text = content.text === null ? null : content.text.trim();
  if (text !== null && text.length > CHAT_TEXT_MAX_LENGTH) {
    throw new AppError('VALIDATION_ERROR', 'The message text is too long.');
  }
  const hasText = text !== null && text.length > 0;
  const hasImage = content.imageId !== null;
  if (!hasText && !hasImage) {
    throw new AppError('VALIDATION_ERROR', 'The message must include text or an image.');
  }
  return {
    text: hasText ? (text as string) : null,
    imageId: hasImage ? (content.imageId as string) : null,
    type: hasImage ? 'IMAGE' : 'TEXT',
  };
}
