import { AppError } from '@/shared/utils/errors';
import { areaRateToSatang, decimalStringToSatang } from '@/shared/utils/money';

export type FeeConfigMode = 'FIXED_PROJECT' | 'AREA' | 'PER_ROOM';

export interface FeeAmountInput {
  configMode: FeeConfigMode;
  rate: string | null;
  roomAreaSqm: string;
  configuredAmountSatang?: bigint | undefined;
}

export function feeAmountSatang(input: FeeAmountInput): bigint {
  if (input.configMode === 'AREA') {
    if (input.rate === null) {
      throw new AppError('VALIDATION_ERROR', 'The area rate is required.');
    }
    return areaRateToSatang(input.roomAreaSqm, input.rate);
  }
  if (input.configMode === 'FIXED_PROJECT' || input.configMode === 'PER_ROOM') {
    if (input.rate === null) {
      throw new AppError('VALIDATION_ERROR', 'The fee rate is required.');
    }
    return decimalStringToSatang(input.rate);
  }
  throw new AppError('VALIDATION_ERROR', 'The fee config mode is invalid.');
}

export function rentAmountSatang(rate: string | null): bigint {
  if (rate === null) {
    throw new AppError('VALIDATION_ERROR', 'The rent rate is required.');
  }
  return decimalStringToSatang(rate);
}

export function oneTimeAmountSatang(
  configuredAmountSatang: bigint | null,
  fallback: FeeAmountInput | null,
): bigint {
  if (configuredAmountSatang !== null) return configuredAmountSatang;
  if (fallback === null) {
    throw new AppError('VALIDATION_ERROR', 'The one-time amount is required.');
  }
  return feeAmountSatang(fallback);
}
