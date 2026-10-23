import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  normalizePhone,
  normalizeUsername,
  validateUsername,
} from '@/modules/identity-access/domain/username';

describe('UT-ID-04 username normalization and immutability', () => {
  it('trims and lowercases usernames', () => {
    expect(normalizeUsername('  Alice_01 ')).toBe('alice_01');
  });

  it('accepts boundary lengths 3 and 30', () => {
    expect(validateUsername('abc')).toBeNull();
    expect(validateUsername('a'.repeat(30))).toBeNull();
  });

  it('rejects lengths 2 and 31', () => {
    expect(validateUsername('ab')).toBe('USERNAME_TOO_SHORT');
    expect(validateUsername('a'.repeat(31))).toBe('USERNAME_TOO_LONG');
  });

  it('rejects characters outside the library charset', () => {
    expect(validateUsername('alice!')).toBe('USERNAME_INVALID_CHARS');
    expect(validateUsername('alice smith')).toBe('USERNAME_INVALID_CHARS');
  });

  it('accepts dots and underscores per the library charset', () => {
    expect(validateUsername('alice.smith_01')).toBeNull();
  });

  it('normalizes email trim and lowercase', () => {
    expect(normalizeEmail('  Alice@Example.Invalid ')).toBe('alice@example.invalid');
  });

  it('normalizes phone display separators', () => {
    expect(normalizePhone('+66 (0) 81-234 5678')).toBe('+660812345678');
  });
});
