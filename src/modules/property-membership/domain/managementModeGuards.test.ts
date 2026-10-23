import { describe, expect, it } from 'vitest';
import {
  canAccessPrivateOwnedTicket,
  canManageTenancy,
  projectManagedTenantRoutesToAdmin,
  tenancyManagerFor,
} from './managementModeGuards';

describe('UT-PR-04 rental management mode is separate from ownership', () => {
  it('routes project-managed tenancies to admin and private tenancies to owners', () => {
    expect(tenancyManagerFor('PROJECT_MANAGED')).toBe('ADMIN');
    expect(tenancyManagerFor('PRIVATE_OWNER_MANAGED')).toBe('OWNER');
    expect(projectManagedTenantRoutesToAdmin('PROJECT_MANAGED')).toBe(true);
    expect(projectManagedTenantRoutesToAdmin('PRIVATE_OWNER_MANAGED')).toBe(false);
  });

  it('lets only admins manage project-managed tenancies', () => {
    expect(
      canManageTenancy('PROJECT_MANAGED', { actorIsSystemAdmin: true, actorIsActiveOwner: false }),
    ).toBe(true);
    expect(
      canManageTenancy('PROJECT_MANAGED', { actorIsSystemAdmin: false, actorIsActiveOwner: true }),
    ).toBe(false);
  });

  it('lets active owners manage private tenancies without admin', () => {
    expect(
      canManageTenancy('PRIVATE_OWNER_MANAGED', {
        actorIsSystemAdmin: false,
        actorIsActiveOwner: true,
      }),
    ).toBe(true);
    expect(
      canManageTenancy('PRIVATE_OWNER_MANAGED', {
        actorIsSystemAdmin: false,
        actorIsActiveOwner: false,
      }),
    ).toBe(false);
  });

  it('keeps private-owner tickets on reporter plus snapshotted recipients', () => {
    expect(
      canAccessPrivateOwnedTicket({
        routingKind: 'PRIVATE_OWNER',
        actor: { actorIsReporter: false, actorIsSystemAdmin: true },
        actorIsSnapshottedRecipient: false,
      }),
    ).toBe(false);
    expect(
      canAccessPrivateOwnedTicket({
        routingKind: 'PRIVATE_OWNER',
        actor: { actorIsReporter: false, actorIsSystemAdmin: false },
        actorIsSnapshottedRecipient: true,
      }),
    ).toBe(true);
    expect(
      canAccessPrivateOwnedTicket({
        routingKind: 'PRIVATE_OWNER',
        actor: { actorIsReporter: true, actorIsSystemAdmin: false },
        actorIsSnapshottedRecipient: false,
      }),
    ).toBe(true);
  });

  it('routes project-managed private tickets to reporter plus admin', () => {
    expect(
      canAccessPrivateOwnedTicket({
        routingKind: 'PROJECT_MANAGED_PRIVATE',
        actor: { actorIsReporter: false, actorIsSystemAdmin: true },
        actorIsSnapshottedRecipient: false,
      }),
    ).toBe(true);
    expect(
      canAccessPrivateOwnedTicket({
        routingKind: 'PROJECT_MANAGED_PRIVATE',
        actor: { actorIsReporter: false, actorIsSystemAdmin: false },
        actorIsSnapshottedRecipient: true,
      }),
    ).toBe(false);
  });
});
