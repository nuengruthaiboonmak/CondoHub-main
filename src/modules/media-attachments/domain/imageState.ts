export const IMAGE_STATES = ['PENDING', 'UPLOADED', 'READY', 'REJECTED', 'ORPHANED'] as const;

export type ImageState = (typeof IMAGE_STATES)[number];

export function isImageState(value: unknown): value is ImageState {
  return typeof value === 'string' && (IMAGE_STATES as readonly string[]).includes(value);
}

export function canCompleteFrom(state: ImageState): boolean {
  return state === 'PENDING';
}

export function isTerminalImageState(state: ImageState): boolean {
  return state === 'REJECTED' || state === 'ORPHANED';
}

export function isIntentExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}
