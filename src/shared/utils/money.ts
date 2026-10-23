import Decimal from 'decimal.js';
import { PROJECT_CURRENCY } from '../../config/project';
import { AppError, type FieldErrors } from './errors';

export const MONEY_STRING_REGEX = /^(0|[1-9]\d*)\.\d{2}$/;

export const SATANG_PER_UNIT = 100n;

export const INT64_MIN = -(1n << 63n);
export const INT64_MAX = (1n << 63n) - 1n;

export interface MoneyWire {
  amount: string;
  currency: string;
}

function validationError(field: string, message: string): AppError {
  const fieldErrors: FieldErrors = { [field]: [message] };
  return new AppError('VALIDATION_ERROR', 'The money value is invalid.', { fieldErrors });
}

function assertInt64(satang: bigint, field: string): void {
  if (satang < INT64_MIN || satang > INT64_MAX) {
    throw validationError(field, 'The amount exceeds the supported range.');
  }
}

export function satangToDecimalString(satang: bigint): string {
  assertInt64(satang, 'amount');
  const sign = satang < 0n ? '-' : '';
  const absolute = satang < 0n ? -satang : satang;
  const units = absolute / SATANG_PER_UNIT;
  const minor = absolute % SATANG_PER_UNIT;
  return `${sign}${units.toString()}.${minor.toString().padStart(2, '0')}`;
}

export function decimalStringToSatang(amount: string, field = 'amount'): bigint {
  if (!MONEY_STRING_REGEX.test(amount)) {
    throw validationError(field, 'The amount must look like "3000.00" (exactly 2 decimals).');
  }
  const [units, minor] = amount.split('.');
  if (units === undefined || minor === undefined) {
    throw validationError(field, 'The amount must look like "3000.00" (exactly 2 decimals).');
  }
  const satang = BigInt(units) * SATANG_PER_UNIT + BigInt(minor);
  assertInt64(satang, field);
  return satang;
}

export function parseMoneyWire(input: MoneyWire, field = 'amount'): bigint {
  if (input.currency !== PROJECT_CURRENCY) {
    throw validationError('currency', `The currency must be "${PROJECT_CURRENCY}".`);
  }
  if (typeof input.amount !== 'string') {
    throw validationError(field, 'The amount must be a decimal string.');
  }
  return decimalStringToSatang(input.amount, field);
}

export function areaRateToSatang(
  area: Decimal.Value,
  rate: Decimal.Value,
  field = 'amount',
): bigint {
  const satang = new Decimal(area)
    .times(new Decimal(rate))
    .times(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const result = BigInt(satang.toFixed(0));
  assertInt64(result, field);
  return result;
}

export class Money {
  private constructor(private readonly satang: bigint) {}

  static fromSatang(satang: bigint): Money {
    assertInt64(satang, 'amount');
    return new Money(satang);
  }

  static fromWire(input: MoneyWire): Money {
    return new Money(parseMoneyWire(input));
  }

  static zero(): Money {
    return new Money(0n);
  }

  toSatang(): bigint {
    return this.satang;
  }

  toWire(): MoneyWire {
    return { amount: satangToDecimalString(this.satang), currency: PROJECT_CURRENCY };
  }

  add(other: Money): Money {
    return Money.fromSatang(this.satang + other.satang);
  }

  subtract(other: Money): Money {
    return Money.fromSatang(this.satang - other.satang);
  }

  compareTo(other: Money): number {
    if (this.satang < other.satang) return -1;
    if (this.satang > other.satang) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.satang === other.satang;
  }

  isZero(): boolean {
    return this.satang === 0n;
  }

  isPositive(): boolean {
    return this.satang > 0n;
  }

  isNegative(): boolean {
    return this.satang < 0n;
  }
}
