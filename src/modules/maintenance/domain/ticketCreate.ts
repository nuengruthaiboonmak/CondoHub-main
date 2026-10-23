import { AppError } from '@/shared/utils/errors';
import type { MaintenanceRoutingKind } from '../infrastructure/schema';

export interface CreateRoutingSelection {
  routingKind: MaintenanceRoutingKind;
  roomId: string | null | undefined;
}

export function assertRoutingSelectionValid(selection: CreateRoutingSelection): void {
  if (selection.routingKind === 'COMMON_AREA') {
    if (selection.roomId !== undefined && selection.roomId !== null) {
      throw new AppError('VALIDATION_ERROR', 'Common area tickets must not select a room.');
    }
    return;
  }
  if (selection.roomId === undefined || selection.roomId === null) {
    throw new AppError('VALIDATION_ERROR', 'Room tickets must select exactly one eligible room.');
  }
}

export interface EligibleSelection {
  roomId: string;
  eligibleRoomIds: readonly string[];
}

export function assertSelectedRoomEligible(selection: EligibleSelection): void {
  if (!selection.eligibleRoomIds.includes(selection.roomId)) {
    throw new AppError('VALIDATION_ERROR', 'The selected room is not eligible for this ticket.');
  }
}

export function assertRecipientsPresent(count: number): void {
  if (count === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The selected room has no owners to receive this ticket.',
    );
  }
}

export interface MembershipWindowLike {
  roomId: string;
  tenancyId: string | null;
  start: Date;
  end: Date | null;
}

export function actorWindowBoundToTenancies(
  windows: readonly MembershipWindowLike[],
  roomId: string,
  tenancyIds: ReadonlySet<string>,
  at: Date,
): boolean {
  return windows.some(
    (window) =>
      window.roomId === roomId &&
      window.tenancyId !== null &&
      tenancyIds.has(window.tenancyId) &&
      window.start.getTime() <= at.getTime() &&
      (window.end === null || window.end.getTime() > at.getTime()),
  );
}
