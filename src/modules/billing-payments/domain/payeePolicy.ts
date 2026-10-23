import { AppError } from '@/shared/utils/errors';

export interface PayeeSnapshot {
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageId: string | null;
}

export interface PayeeConfirmInput {
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageId?: string | null | undefined;
  confirmed: boolean;
}

export function buildPayeeSnapshot(input: PayeeConfirmInput): PayeeSnapshot {
  if (input.confirmed !== true) {
    throw new AppError('VALIDATION_ERROR', 'The payee confirmation is required.');
  }
  if (input.bankName.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The payee bank name is required.');
  }
  if (input.accountName.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The payee account name is required.');
  }
  if (input.accountNumber.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The payee account number is required.');
  }
  return {
    bankName: input.bankName,
    accountName: input.accountName,
    accountNumber: input.accountNumber,
    qrImageId: input.qrImageId ?? null,
  };
}

export function systemAutoPayee(): PayeeSnapshot {
  return {
    bankName: 'System Auto',
    accountName: 'System Auto',
    accountNumber: 'SYSTEM-AUTO',
    qrImageId: null,
  };
}

export function payeeSnapshotToRecord(snapshot: PayeeSnapshot): Record<string, unknown> {
  return {
    bankName: snapshot.bankName,
    accountName: snapshot.accountName,
    accountNumber: snapshot.accountNumber,
    qrImageId: snapshot.qrImageId,
  };
}
