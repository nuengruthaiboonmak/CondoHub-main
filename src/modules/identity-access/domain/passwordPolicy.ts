export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  'password',
  'password123',
  '123456789012',
  'qwertyuiopas',
  'letmeinletme',
  'welcomehome1',
  'changeme1234',
  'condohub1234',
  'adminadmin12',
  'temporary123',
]);

export type PasswordViolation =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_EQUALS_USERNAME'
  | 'PASSWORD_EQUALS_TEMP'
  | 'PASSWORD_TOO_COMMON';

export interface PasswordCheckInput {
  password: string;
  username: string;
  tempPassword?: string;
}

export function validatePassword(input: PasswordCheckInput): PasswordViolation | null {
  if (input.password.length < PASSWORD_MIN_LENGTH) return 'PASSWORD_TOO_SHORT';
  if (input.password.length > PASSWORD_MAX_LENGTH) return 'PASSWORD_TOO_LONG';
  if (input.password === input.username) return 'PASSWORD_EQUALS_USERNAME';
  if (input.tempPassword !== undefined && input.password === input.tempPassword) {
    return 'PASSWORD_EQUALS_TEMP';
  }
  if (COMMON_PASSWORDS.has(input.password.toLowerCase())) return 'PASSWORD_TOO_COMMON';
  return null;
}
