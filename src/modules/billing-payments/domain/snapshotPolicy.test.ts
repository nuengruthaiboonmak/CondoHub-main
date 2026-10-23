import { describe, expect, it } from 'vitest';
import { assertSnapshotOwners, assertValidPayeeSnapshot, decideFeeSnapshot } from './snapshotPolicy';

describe('Q-DM-007 room-needs-owner split', () => {
  it('snapshots owners when the boundary set is non-empty', () => {
    const owners = [{ userId: 'owner-a', ownershipId: 'own-1' }];
    expect(decideFeeSnapshot({ ownersAtBoundary: owners, managementMode: 'PRIVATE_OWNER_MANAGED' })).toEqual({
      outcome: 'SNAPSHOT',
      owners,
    });
    expect(assertSnapshotOwners(owners, 'PRIVATE_OWNER_MANAGED')).toEqual(owners);
  });

  it('falls back to room-based invoices for project-managed rooms without owners', () => {
    expect(decideFeeSnapshot({ ownersAtBoundary: [], managementMode: 'PROJECT_MANAGED' })).toEqual({
      outcome: 'ROOM_BASED',
    });
    expect(assertSnapshotOwners([], 'PROJECT_MANAGED')).toBeNull();
  });

  it('records a cycle error when a private room has no owner at the boundary', () => {
    const decision = decideFeeSnapshot({ ownersAtBoundary: [], managementMode: 'PRIVATE_OWNER_MANAGED' });
    expect(decision.outcome).toBe('CYCLE_ERROR');
    expect(() => assertSnapshotOwners([], 'PRIVATE_OWNER_MANAGED')).toThrowError();
    expect(() => assertSnapshotOwners([], 'UNKNOWN')).toThrowError();
  });
});

describe('S6 payee snapshot input policy', () => {
  it('accepts a complete payee snapshot', () => {
    expect(() =>
      assertValidPayeeSnapshot({
        bankName: 'Example Bank',
        accountName: 'Example Owner',
        accountNumber: '1234567890',
        qrImageId: null,
      }),
    ).not.toThrow();
  });

  it('rejects blank payee fields', () => {
    expect(() =>
      assertValidPayeeSnapshot({ bankName: '  ', accountName: 'Name', accountNumber: '1', qrImageId: null }),
    ).toThrowError();
    expect(() =>
      assertValidPayeeSnapshot({ bankName: 'Bank', accountName: '', accountNumber: '1', qrImageId: null }),
    ).toThrowError();
    expect(() =>
      assertValidPayeeSnapshot({ bankName: 'Bank', accountName: 'Name', accountNumber: ' ', qrImageId: null }),
    ).toThrowError();
  });
});
