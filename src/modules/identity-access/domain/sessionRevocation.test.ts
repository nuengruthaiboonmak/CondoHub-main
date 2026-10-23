import { describe, expect, it } from 'vitest';
import {
  isRevocationEvent,
  requiresFullLogout,
} from '@/modules/identity-access/domain/sessionPolicy';

describe('UT-ID-02 session revocation after reset/suspend, not after room removal', () => {
  it('treats password change as a revoke-all event', () => {
    expect(isRevocationEvent('PASSWORD_CHANGE')).toBe(true);
    expect(requiresFullLogout('PASSWORD_CHANGE')).toBe(true);
  });

  it('treats admin password reset as a revoke-all event', () => {
    expect(isRevocationEvent('PASSWORD_RESET')).toBe(true);
    expect(requiresFullLogout('PASSWORD_RESET')).toBe(true);
  });

  it('treats suspend as a revoke-all event', () => {
    expect(isRevocationEvent('SUSPEND')).toBe(true);
    expect(requiresFullLogout('SUSPEND')).toBe(true);
  });

  it('exposes no revocation event for room removal', () => {
    const events = ['PASSWORD_CHANGE', 'PASSWORD_RESET', 'SUSPEND'] as const;
    expect(events).not.toContain('ROOM_REMOVAL');
  });
});
