import 'server-only';
import { randomBytes } from 'node:crypto';

export const TEMP_PASSWORD_LENGTH = 20;

export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export interface TempPasswordGenerator {
  generate(length?: number): string;
}

export function createTempPasswordGenerator(): TempPasswordGenerator {
  return {
    generate(length = TEMP_PASSWORD_LENGTH): string {
      const bytes = randomBytes(length);
      let password = '';
      for (const byte of bytes) {
        const index = byte % TEMP_PASSWORD_ALPHABET.length;
        password += TEMP_PASSWORD_ALPHABET.charAt(index);
      }
      return password;
    },
  };
}

export const tempPasswordGenerator = createTempPasswordGenerator();
