import { describe, expect, it } from 'vitest';
import type { Actor } from '@/shared/auth/actor';
import {
  canProvisionInRoom,
  canProvisionSystemWide,
  type RoomEntitlement,
} from '@/modules/identity-access/domain/provisioningPolicy';

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'actor-1',
    isSystemAdmin: false,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    ...overrides,
  };
}

function entitlement(overrides: Partial<RoomEntitlement> = {}): RoomEntitlement {
  return {
    roomId: 'room-1',
    managementMode: 'PROJECT_MANAGED',
    isCurrentOwner: false,
    isTopTenantManager: false,
    ...overrides,
  };
}

describe('UT-ID-03 D05 provisioning matrix', () => {
  it('lets an admin create a project-managed tenant', () => {
    const verdict = canProvisionInRoom(
      actor({ isSystemAdmin: true }),
      entitlement({ managementMode: 'PROJECT_MANAGED' }),
      'TENANT',
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it('lets a current owner create a private-room tenant', () => {
    const verdict = canProvisionInRoom(
      actor(),
      entitlement({ managementMode: 'PRIVATE_OWNER_MANAGED', isCurrentOwner: true }),
      'TENANT',
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it('lets an eligible main create a same-room tenant', () => {
    const verdict = canProvisionInRoom(
      actor(),
      entitlement({ managementMode: 'PROJECT_MANAGED', isTopTenantManager: true }),
      'TENANT',
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it('denies a plain resident provisioning in a private room', () => {
    const verdict = canProvisionInRoom(
      actor(),
      entitlement({ managementMode: 'PRIVATE_OWNER_MANAGED' }),
      'TENANT',
    );
    expect(verdict.allowed).toBe(false);
  });

  it('denies admin co-owner grants through the tenant path', () => {
    const verdict = canProvisionInRoom(
      actor({ isSystemAdmin: true }),
      entitlement({ managementMode: 'PROJECT_MANAGED' }),
      'CO_OWNER',
    );
    expect(verdict).toEqual({ allowed: false, reason: 'ROLE_ESCALATION' });
  });

  it('lets any current owner grant a co-owner', () => {
    const verdict = canProvisionInRoom(
      actor(),
      entitlement({ managementMode: 'PRIVATE_OWNER_MANAGED', isCurrentOwner: true }),
      'CO_OWNER',
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it('forbids tenants from creating owners', () => {
    const verdict = canProvisionInRoom(
      actor(),
      entitlement({ managementMode: 'PRIVATE_OWNER_MANAGED', isTopTenantManager: true }),
      'CO_OWNER',
    );
    expect(verdict).toEqual({ allowed: false, reason: 'OWNER_REQUIRED' });
  });

  it('limits system-wide provisioning to admins', () => {
    expect(canProvisionSystemWide(actor({ isSystemAdmin: true }))).toBe(true);
    expect(canProvisionSystemWide(actor())).toBe(false);
  });
});
