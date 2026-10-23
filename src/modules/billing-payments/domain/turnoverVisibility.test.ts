import { describe, expect, it } from 'vitest';
import {
  countVisibleUnresolved,
  evaluateTurnoverVisibility,
  scopeForManagementMode,
  turnoverCountsTowardIndicator,
} from './turnoverVisibility';

describe('UT-BL-02A D03-C1 review UNRESOLVED remains indefinitely with dashboard queue and indicator', () => {
  it('counts UNRESOLVED reviews toward the indicator while terminal states drop off', () => {
    expect(
      countVisibleUnresolved({
        reviews: [
          { state: 'UNRESOLVED', visible: true },
          { state: 'UNRESOLVED', visible: true },
          { state: 'RESOLVED', visible: true },
          { state: 'NO_CHARGE', visible: true },
        ],
      }),
    ).toBe(2);
  });

  it('derives the indicator from count alone so opening or dismissing never removes work', () => {
    expect(turnoverCountsTowardIndicator({ state: 'UNRESOLVED', visible: true })).toBe(true);
    expect(turnoverCountsTowardIndicator({ state: 'RESOLVED', visible: true })).toBe(false);
    expect(turnoverCountsTowardIndicator({ state: 'NO_CHARGE', visible: true })).toBe(false);
  });

  it('keeps unauthorized users out of visibility so they see no metadata', () => {
    expect(turnoverCountsTowardIndicator({ state: 'UNRESOLVED', visible: false })).toBe(false);
    expect(
      countVisibleUnresolved({ reviews: [{ state: 'UNRESOLVED', visible: false }] }),
    ).toBe(0);
  });
});

describe('UT-BL-02A PROJECT_MANAGED scope is admin-only; suspended actors are denied', () => {
  it('admits admins to project-managed reviews', () => {
    expect(
      evaluateTurnoverVisibility({
        state: 'UNRESOLVED',
        scope: 'PROJECT_MANAGED',
        actorIsSystemAdmin: true,
        actorSuspended: false,
        actorInS2Snapshot: false,
      }),
    ).toEqual({ allowed: true });
  });

  it('denies non-admin actors on project-managed reviews without concealment', () => {
    expect(
      evaluateTurnoverVisibility({
        state: 'UNRESOLVED',
        scope: 'PROJECT_MANAGED',
        actorIsSystemAdmin: false,
        actorSuspended: false,
        actorInS2Snapshot: false,
      }),
    ).toEqual({ allowed: false, httpStatus: 403 });
  });

  it('denies suspended actors before any scope check', () => {
    expect(
      evaluateTurnoverVisibility({
        state: 'UNRESOLVED',
        scope: 'PROJECT_MANAGED',
        actorIsSystemAdmin: true,
        actorSuspended: true,
        actorInS2Snapshot: false,
      }),
    ).toEqual({ allowed: false, httpStatus: 403 });
    expect(
      evaluateTurnoverVisibility({
        state: 'UNRESOLVED',
        scope: 'PRIVATE',
        actorIsSystemAdmin: false,
        actorSuspended: true,
        actorInS2Snapshot: true,
      }),
    ).toEqual({ allowed: false, httpStatus: 403 });
  });

  it('maps stored management modes to queue scopes', () => {
    expect(scopeForManagementMode('PROJECT_MANAGED')).toBe('PROJECT_MANAGED');
    expect(scopeForManagementMode('PRIVATE_OWNER_MANAGED')).toBe('PRIVATE');
    expect(scopeForManagementMode('UNKNOWN')).toBe('PRIVATE');
  });
});

describe('UT-BL-02C D11-A original owners keep LIST/COUNT/DETAIL/RESOLVE after selling to B', () => {
  it('admits snapshot members on private reviews even after they stop being owners', () => {
    expect(
      evaluateTurnoverVisibility({
        state: 'UNRESOLVED',
        scope: 'PRIVATE',
        actorIsSystemAdmin: false,
        actorSuspended: false,
        actorInS2Snapshot: true,
      }),
    ).toEqual({ allowed: true });
  });

  it('conceals private reviews from the new owner B with no metadata', () => {
    expect(
      evaluateTurnoverVisibility({
        state: 'UNRESOLVED',
        scope: 'PRIVATE',
        actorIsSystemAdmin: false,
        actorSuspended: false,
        actorInS2Snapshot: false,
      }),
    ).toEqual({ allowed: false, httpStatus: 404 });
  });

  it('conceals private reviews from strangers outside the snapshot', () => {
    expect(
      evaluateTurnoverVisibility({
        state: 'UNRESOLVED',
        scope: 'PRIVATE',
        actorIsSystemAdmin: false,
        actorSuspended: false,
        actorInS2Snapshot: false,
      }),
    ).toEqual({ allowed: false, httpStatus: 404 });
  });

  it('conceals private reviews from system admins guessing review ids', () => {
    expect(
      evaluateTurnoverVisibility({
        state: 'UNRESOLVED',
        scope: 'PRIVATE',
        actorIsSystemAdmin: true,
        actorSuspended: false,
        actorInS2Snapshot: false,
      }),
    ).toEqual({ allowed: false, httpStatus: 404 });
  });

  it('keeps disabled original reviewers denied while the review stays UNRESOLVED', () => {
    expect(
      evaluateTurnoverVisibility({
        state: 'UNRESOLVED',
        scope: 'PRIVATE',
        actorIsSystemAdmin: false,
        actorSuspended: true,
        actorInS2Snapshot: true,
      }),
    ).toEqual({ allowed: false, httpStatus: 403 });
  });
});
