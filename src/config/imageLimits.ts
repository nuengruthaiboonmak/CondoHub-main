import type { ImageScope } from '../shared/storage/objectKeys';

export const IMAGE_BYTE_CAP_SLIP = 10_000_000;
export const IMAGE_BYTE_CAP_DEFAULT = 5_000_000;
export const IMAGE_OPTIMIZE_TARGET_BYTES = 2_000_000;

export const IMAGE_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ImageAllowedMime = (typeof IMAGE_ALLOWED_MIMES)[number];

export const IMAGE_BYTE_CAPS: Record<ImageScope, number> = {
  PAYMENT_SLIP: IMAGE_BYTE_CAP_SLIP,
  PAYMENT_QR: IMAGE_BYTE_CAP_DEFAULT,
  MAINTENANCE: IMAGE_BYTE_CAP_DEFAULT,
  ANNOUNCEMENT: IMAGE_BYTE_CAP_DEFAULT,
  CHAT: IMAGE_BYTE_CAP_DEFAULT,
};

export const IMAGE_COUNT_ACTIONS = [
  'SUBMIT_PAYMENT',
  'SAVE_PAYMENT_INSTRUCTION',
  'SEND_CHAT_MESSAGE',
  'CREATE_TICKET',
  'ADD_TICKET_COMMENT',
  'PUBLISH_ANNOUNCEMENT',
] as const;

export type ImageCountAction = (typeof IMAGE_COUNT_ACTIONS)[number];

export interface ImageCountCap {
  scope: ImageScope;
  min: number;
  max: number;
}

export const IMAGE_COUNT_CAPS: Record<ImageCountAction, ImageCountCap> = {
  SUBMIT_PAYMENT: { scope: 'PAYMENT_SLIP', min: 1, max: 1 },
  SAVE_PAYMENT_INSTRUCTION: { scope: 'PAYMENT_QR', min: 0, max: 1 },
  SEND_CHAT_MESSAGE: { scope: 'CHAT', min: 0, max: 1 },
  CREATE_TICKET: { scope: 'MAINTENANCE', min: 0, max: 5 },
  ADD_TICKET_COMMENT: { scope: 'MAINTENANCE', min: 0, max: 3 },
  PUBLISH_ANNOUNCEMENT: { scope: 'ANNOUNCEMENT', min: 0, max: 5 },
};

export interface ImageLimitsConfig {
  byteCaps: Record<ImageScope, number>;
  countCaps: Record<ImageCountAction, ImageCountCap>;
  allowedMimes: readonly ImageAllowedMime[];
  optimizeTargetBytes: number;
}

export const imageLimits: ImageLimitsConfig = {
  byteCaps: IMAGE_BYTE_CAPS,
  countCaps: IMAGE_COUNT_CAPS,
  allowedMimes: IMAGE_ALLOWED_MIMES,
  optimizeTargetBytes: IMAGE_OPTIMIZE_TARGET_BYTES,
};
