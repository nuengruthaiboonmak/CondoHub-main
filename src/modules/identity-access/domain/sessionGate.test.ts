import { describe, expect, it } from 'vitest';
import { evaluateSessionGate } from '@/modules/identity-access/domain/sessionPolicy';
import { validatePassword } from '@/modules/identity-access/domain/passwordPolicy';

interface GateActor {
  userId: string;
  isSystemAdmin: boolean;
  accountStatus: 'ACTIVE' | 'SUSPENDED';
  mustChangePassword: boolean;
}

function actor(overrides: Partial<GateActor> = {}): GateActor {
  return {
    userId: 'user-1',
    isSystemAdmin: false,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    ...overrides,
  };
}

describe('UT-ID-01 first login gate, temp password change, suspended account', () => {
  it('allows a fully active actor through the gate', () => {
    expect(evaluateSessionGate(actor())).toBe('ALLOW');
  });

  it('routes first-login actors to the password-change gate', () => {
    expect(evaluateSessionGate(actor({ mustChangePassword: true }))).toBe('FIRST_LOGIN');
  });

  it('denies suspended actors generically', () => {
    expect(evaluateSessionGate(actor({ accountStatus: 'SUSPENDED' }))).toBe('SUSPENDED');
  });

  it('suspended wins over first-login when both flags are set', () => {
    expect(
      evaluateSessionGate(actor({ accountStatus: 'SUSPENDED', mustChangePassword: true })),
    ).toBe('SUSPENDED');
  });

  it('accepts a compliant new password', () => {
    expect(
      validatePassword({ password: 'a-strong-new-password-1', username: 'someuser' }),
    ).toBeNull();
  });

  it('rejects a new password shorter than 12 characters', () => {
    expect(validatePassword({ password: 'short-1', username: 'someuser' })).toBe(
      'PASSWORD_TOO_SHORT',
    );
  });

  it('rejects a new password equal to the username or temp password', () => {
    expect(
      validatePassword({ password: 'someuser-123', username: 'someuser-123' }),
    ).toBe('PASSWORD_EQUALS_USERNAME');
    expect(
      validatePassword({ password: 'temp-secret-1', username: 'someuser', tempPassword: 'temp-secret-1' }),
    ).toBe('PASSWORD_EQUALS_TEMP');
  });

  it('rejects common passwords at the boundary length', () => {
    expect(validatePassword({ password: 'letmeinletme', username: 'someuser' })).toBe(
      'PASSWORD_TOO_COMMON',
    );
  });
});
