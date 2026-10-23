import { AppError } from '@/shared/utils/errors';

export interface OwnerSnapshotRef {
  userId: string;
  ownershipId: string;
}

export type FeeSnapshotDecision =
  | { outcome: 'SNAPSHOT'; owners: OwnerSnapshotRef[] }
  | { outcome: 'ROOM_BASED' }
  | { outcome: 'CYCLE_ERROR'; reason: string };

export function decideFeeSnapshot(input: {
  ownersAtBoundary: OwnerSnapshotRef[];
  managementMode: 'PROJECT_MANAGED' | 'PRIVATE_OWNER_MANAGED' | 'UNKNOWN';
}): FeeSnapshotDecision {
  if (input.ownersAtBoundary.length > 0) {
    return { outcome: 'SNAPSHOT', owners: input.ownersAtBoundary };
  }
  if (input.managementMode === 'PROJECT_MANAGED') return { outcome: 'ROOM_BASED' };
  return {
    outcome: 'CYCLE_ERROR',
    reason: 'The ownership history is missing at the snapshot boundary.',
  };
}

export function assertSnapshotOwners(
  owners: OwnerSnapshotRef[],
  managementMode: 'PROJECT_MANAGED' | 'PRIVATE_OWNER_MANAGED' | 'UNKNOWN',
): OwnerSnapshotRef[] | null {
  const decision = decideFeeSnapshot({ ownersAtBoundary: owners, managementMode });
  if (decision.outcome === 'SNAPSHOT') return decision.owners;
  if (decision.outcome === 'ROOM_BASED') return null;
  throw new AppError('VALIDATION_ERROR', decision.reason);
}

export interface PayeeSnapshot {
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageId: string | null;
}

export function assertValidPayeeSnapshot(value: PayeeSnapshot): void {
  if (value.bankName.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The payee bank name is required.');
  }
  if (value.accountName.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The payee account name is required.');
  }
  if (value.accountNumber.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The payee account number is required.');
  }
}
