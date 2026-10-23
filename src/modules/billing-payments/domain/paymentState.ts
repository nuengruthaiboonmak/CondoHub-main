import { AppError } from '@/shared/utils/errors';

export type DerivedInvoiceState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export type SubmissionLifecycle = 'PENDING' | 'APPROVED' | 'REJECTED';

export function deriveInvoiceState(
  totalSatang: bigint,
  approvedTotalSatang: bigint,
): DerivedInvoiceState {
  if (approvedTotalSatang < 0n || approvedTotalSatang > totalSatang) {
    throw new AppError('INTERNAL_ERROR', 'The approved total is outside the invoice total.');
  }
  if (approvedTotalSatang === totalSatang) return 'PAID';
  if (approvedTotalSatang === 0n) return 'UNPAID';
  return 'PARTIALLY_PAID';
}

export function outstandingSatang(totalSatang: bigint, approvedTotalSatang: bigint): bigint {
  const outstanding = totalSatang - approvedTotalSatang;
  if (outstanding < 0n) {
    throw new AppError('INTERNAL_ERROR', 'The approved total exceeds the invoice total.');
  }
  return outstanding;
}

export function isOverdue(input: {
  projectToday: string;
  dueDate: string;
  outstandingSatang: bigint;
}): boolean {
  return input.outstandingSatang > 0n && input.projectToday > input.dueDate;
}

export function assertApprovable(input: {
  amountSatang: bigint;
  outstandingSatang: bigint;
}): void {
  if (input.amountSatang <= 0n) {
    throw new AppError('VALIDATION_ERROR', 'The approved amount must be greater than zero.');
  }
  if (input.amountSatang > input.outstandingSatang) {
    throw new AppError('PAYMENT_APPROVED_AMOUNT_EXCEEDS_OUTSTANDING');
  }
}

export function assertEditableTotal(input: {
  invoicePaid: boolean;
  approvedTotalSatang: bigint;
  newTotalSatang: bigint;
}): void {
  if (input.invoicePaid) throw new AppError('INVOICE_ALREADY_PAID');
  if (input.newTotalSatang < input.approvedTotalSatang) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The new total must be at least the approved total.',
    );
  }
}

export function assertReviewTransition(current: SubmissionLifecycle): void {
  if (current !== 'PENDING') throw new AppError('PAYMENT_ALREADY_REVIEWED');
}

export function pendingOnPaidFlag(input: {
  invoicePaid: boolean;
  pendingCount: number;
}): boolean {
  return input.invoicePaid && input.pendingCount > 0;
}
