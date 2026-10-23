import { describe, expect, it } from 'vitest';
import {
  allowedRoutingKinds,
  evaluateTicketAccess,
  type TicketActorGrants,
} from './ticketPolicy';

function grants(overrides: Partial<TicketActorGrants> = {}): TicketActorGrants {
  return {
    actorIsSystemAdmin: false,
    actorSuspended: false,
    actorMustChangePassword: false,
    actorIsReporter: false,
    actorInRecipientSnapshot: false,
    ...overrides,
  };
}

describe('UT-MT-01 Owner-handled private ticket admin explicit denial applies to query, detail, image, and comment', () => {
  it('denies the admin view, comment, and image reads of a private owner ticket with concealment', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'PENDING' as const };
    const admin = grants({ actorIsSystemAdmin: true });
    expect(evaluateTicketAccess(admin, resource, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(evaluateTicketAccess(admin, resource, 'COMMENT')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(evaluateTicketAccess(admin, resource, 'VIEW_IMAGE')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
  });

  it('denies admin transitions of a private owner ticket even as reporter context is claimed', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'PENDING' as const };
    const admin = grants({ actorIsSystemAdmin: true, actorIsReporter: true });
    expect(
      evaluateTicketAccess(admin, resource, 'TRANSITION_TO', { toStatus: 'CANCELLED' }),
    ).toEqual({ allowed: false, httpStatus: 404 });
  });

  it('excludes the private owner kind from the admin list kinds', () => {
    expect(allowedRoutingKinds(true)).toEqual(['COMMON_AREA', 'PROJECT_MANAGED_PRIVATE']);
    expect(allowedRoutingKinds(false)).toEqual([
      'COMMON_AREA',
      'PRIVATE_OWNER',
      'PROJECT_MANAGED_PRIVATE',
    ]);
  });
});

describe('UT-MT-03 Transfer keeps original recipients working while the new owner is denied', () => {
  it('lets original snapshot recipients read, comment, and transition an open ticket', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'IN_PROGRESS' as const };
    const recipient = grants({ actorInRecipientSnapshot: true });
    expect(evaluateTicketAccess(recipient, resource, 'VIEW')).toEqual({ allowed: true });
    expect(evaluateTicketAccess(recipient, resource, 'COMMENT')).toEqual({ allowed: true });
    expect(evaluateTicketAccess(recipient, resource, 'TRANSITION_HANDLER')).toEqual({
      allowed: true,
    });
    expect(
      evaluateTicketAccess(recipient, resource, 'TRANSITION_TO', { toStatus: 'COMPLETED' }),
    ).toEqual({ allowed: true });
  });

  it('denies the new owner who is absent from the snapshot on every action', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'IN_PROGRESS' as const };
    const stranger = grants();
    expect(evaluateTicketAccess(stranger, resource, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(evaluateTicketAccess(stranger, resource, 'COMMENT')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(evaluateTicketAccess(stranger, resource, 'VIEW_IMAGE')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(
      evaluateTicketAccess(stranger, resource, 'TRANSITION_TO', { toStatus: 'COMPLETED' }),
    ).toEqual({ allowed: false, httpStatus: 404 });
  });

  it('denies a disabled snapshot recipient account on every action', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'IN_PROGRESS' as const };
    const suspended = grants({ actorInRecipientSnapshot: true, actorSuspended: true });
    expect(evaluateTicketAccess(suspended, resource, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
    expect(evaluateTicketAccess(suspended, resource, 'COMMENT')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
  });
});

describe('UT-MT-04 Terminal tickets are read-only for original recipients and concealed from others', () => {
  it('lets original recipients read ticket and images but denies every mutation at terminal', () => {
    for (const status of ['COMPLETED', 'REJECTED', 'CANCELLED'] as const) {
      const resource = { routingKind: 'PRIVATE_OWNER' as const, status };
      const recipient = grants({ actorInRecipientSnapshot: true });
      expect(evaluateTicketAccess(recipient, resource, 'VIEW')).toEqual({ allowed: true });
      expect(evaluateTicketAccess(recipient, resource, 'VIEW_IMAGE')).toEqual({ allowed: true });
      expect(evaluateTicketAccess(recipient, resource, 'COMMENT')).toEqual({
        allowed: false,
        httpStatus: 404,
      });
      expect(evaluateTicketAccess(recipient, resource, 'TRANSITION_HANDLER')).toEqual({
        allowed: false,
        httpStatus: 404,
      });
    }
  });

  it('conceals terminal private tickets from the new owner and the admin', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'COMPLETED' as const };
    expect(evaluateTicketAccess(grants(), resource, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(
      evaluateTicketAccess(grants({ actorIsSystemAdmin: true }), resource, 'VIEW'),
    ).toEqual({ allowed: false, httpStatus: 404 });
  });
});

describe('UT-MT-05 Former reporter keeps ticket grant on own ticket without room entitlement', () => {
  it('lets the former reporter read, comment, and view images on an open ticket', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'IN_PROGRESS' as const };
    const reporter = grants({ actorIsReporter: true });
    expect(evaluateTicketAccess(reporter, resource, 'VIEW')).toEqual({ allowed: true });
    expect(evaluateTicketAccess(reporter, resource, 'COMMENT')).toEqual({ allowed: true });
    expect(evaluateTicketAccess(reporter, resource, 'VIEW_IMAGE')).toEqual({ allowed: true });
  });

  it('lets the reporter cancel from pending and waiting for info but not from in progress', () => {
    const reporter = grants({ actorIsReporter: true });
    expect(
      evaluateTicketAccess(
        reporter,
        { routingKind: 'PRIVATE_OWNER', status: 'PENDING' },
        'TRANSITION_TO',
        { toStatus: 'CANCELLED' },
      ),
    ).toEqual({ allowed: true });
    expect(
      evaluateTicketAccess(
        reporter,
        { routingKind: 'PRIVATE_OWNER', status: 'WAITING_FOR_INFO' },
        'TRANSITION_TO',
        { toStatus: 'CANCELLED' },
      ),
    ).toEqual({ allowed: true });
    expect(
      evaluateTicketAccess(
        reporter,
        { routingKind: 'PRIVATE_OWNER', status: 'IN_PROGRESS' },
        'TRANSITION_TO',
        { toStatus: 'CANCELLED' },
      ),
    ).toEqual({ allowed: false, httpStatus: 404 });
  });

  it('denies reporter transitions to handler-only statuses', () => {
    const reporter = grants({ actorIsReporter: true });
    expect(
      evaluateTicketAccess(
        reporter,
        { routingKind: 'PRIVATE_OWNER', status: 'PENDING' },
        'TRANSITION_TO',
        { toStatus: 'IN_PROGRESS' },
      ),
    ).toEqual({ allowed: false, httpStatus: 404 });
    expect(evaluateTicketAccess(reporter, { routingKind: 'PRIVATE_OWNER', status: 'PENDING' }, 'TRANSITION_HANDLER')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
  });

  it('keeps terminal reporter access read-only and denies disabled or third-party actors', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'COMPLETED' as const };
    const reporter = grants({ actorIsReporter: true });
    expect(evaluateTicketAccess(reporter, resource, 'VIEW')).toEqual({ allowed: true });
    expect(evaluateTicketAccess(reporter, resource, 'COMMENT')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(
      evaluateTicketAccess(grants({ actorIsReporter: true, actorSuspended: true }), resource, 'VIEW'),
    ).toEqual({ allowed: false, httpStatus: 403 });
    expect(evaluateTicketAccess(grants(), resource, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
  });
});

describe('UT-MT-06 Suspended recipients are denied while active recipients keep working and reactivation restores the same ticket', () => {
  it('denies every action for a suspended recipient and allows an active co-recipient', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'IN_PROGRESS' as const };
    const suspended = grants({ actorInRecipientSnapshot: true, actorSuspended: true });
    expect(evaluateTicketAccess(suspended, resource, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
    expect(evaluateTicketAccess(suspended, resource, 'VIEW_IMAGE')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
    expect(
      evaluateTicketAccess(suspended, resource, 'TRANSITION_TO', { toStatus: 'COMPLETED' }),
    ).toEqual({ allowed: false, httpStatus: 403 });
    const active = grants({ actorInRecipientSnapshot: true });
    expect(evaluateTicketAccess(active, resource, 'COMMENT')).toEqual({ allowed: true });
    expect(
      evaluateTicketAccess(active, resource, 'TRANSITION_TO', { toStatus: 'COMPLETED' }),
    ).toEqual({ allowed: true });
  });

  it('keeps the active reporter working while every recipient is suspended', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'PENDING' as const };
    const reporter = grants({ actorIsReporter: true });
    expect(evaluateTicketAccess(reporter, resource, 'COMMENT')).toEqual({ allowed: true });
    expect(
      evaluateTicketAccess(reporter, resource, 'TRANSITION_TO', { toStatus: 'CANCELLED' }),
    ).toEqual({ allowed: true });
  });

  it('restores read-only terminal access when a suspended recipient reactivates', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'COMPLETED' as const };
    const suspended = grants({ actorInRecipientSnapshot: true, actorSuspended: true });
    expect(evaluateTicketAccess(suspended, resource, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
    const reactivated = grants({ actorInRecipientSnapshot: true });
    expect(evaluateTicketAccess(reactivated, resource, 'VIEW')).toEqual({ allowed: true });
    expect(evaluateTicketAccess(reactivated, resource, 'COMMENT')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
  });
});

describe('UT-MT-01 admin-routed kinds grant the reporter and admin while denying outsiders', () => {
  it('lets the admin act on admin-routed open tickets and read terminal tickets only', () => {
    for (const routingKind of ['COMMON_AREA', 'PROJECT_MANAGED_PRIVATE'] as const) {
      const open = { routingKind, status: 'PENDING' as const };
      const admin = grants({ actorIsSystemAdmin: true });
      expect(evaluateTicketAccess(admin, open, 'VIEW')).toEqual({ allowed: true });
      expect(evaluateTicketAccess(admin, open, 'COMMENT')).toEqual({ allowed: true });
      expect(
        evaluateTicketAccess(admin, open, 'TRANSITION_TO', { toStatus: 'IN_PROGRESS' }),
      ).toEqual({ allowed: true });
      const terminal = { routingKind, status: 'COMPLETED' as const };
      expect(evaluateTicketAccess(admin, terminal, 'VIEW')).toEqual({ allowed: true });
      expect(evaluateTicketAccess(admin, terminal, 'COMMENT')).toEqual({
        allowed: false,
        httpStatus: 403,
      });
    }
  });

  it('lets the reporter use an open common area ticket and denies same-room non-reporters', () => {
    const resource = { routingKind: 'COMMON_AREA' as const, status: 'PENDING' as const };
    const reporter = grants({ actorIsReporter: true });
    expect(evaluateTicketAccess(reporter, resource, 'COMMENT')).toEqual({ allowed: true });
    expect(evaluateTicketAccess(grants(), resource, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
  });
});
