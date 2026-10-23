export const USERNAME_MIN_LENGTH = 3;

export const USERNAME_MAX_LENGTH = 30;

const USERNAME_CHARSET = /^[a-z0-9_.]+$/;

export type UsernameViolation =
  | 'USERNAME_TOO_SHORT'
  | 'USERNAME_TOO_LONG'
  | 'USERNAME_INVALID_CHARS';

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): UsernameViolation | null {
  if (value.length < USERNAME_MIN_LENGTH) return 'USERNAME_TOO_SHORT';
  if (value.length > USERNAME_MAX_LENGTH) return 'USERNAME_TOO_LONG';
  if (!USERNAME_CHARSET.test(value)) return 'USERNAME_INVALID_CHARS';
  return null;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  return value.trim().replace(/[\s()-]/g, '');
}
