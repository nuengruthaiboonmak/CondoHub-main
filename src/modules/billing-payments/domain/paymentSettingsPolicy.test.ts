import { describe, expect, it } from 'vitest';
import { canManagePaymentSettings } from './paymentSettingsPolicy';

describe('payment settings permissions', () => {
  it('allows admins to manage project accounts only', () => {
    expect(canManagePaymentSettings(true, false, 'PROJECT')).toBe(true);
    expect(canManagePaymentSettings(true, true, 'OWNER')).toBe(false);
  });
  it('allows current owners to manage their private rent account only', () => {
    expect(canManagePaymentSettings(false, true, 'OWNER')).toBe(true);
    expect(canManagePaymentSettings(false, true, 'PROJECT')).toBe(false);
    expect(canManagePaymentSettings(false, false, 'OWNER')).toBe(false);
  });
});
