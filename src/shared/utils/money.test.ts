import { describe, expect, it } from 'vitest';
import {
  INT64_MAX,
  Money,
  areaRateToSatang,
  decimalStringToSatang,
  parseMoneyWire,
  satangToDecimalString,
} from './money';
import { AppError } from './errors';

describe('UT-SH-02 money vectors', () => {
  it('round-trips satang and canonical decimal strings', () => {
    expect(satangToDecimalString(300000n)).toBe('3000.00');
    expect(satangToDecimalString(0n)).toBe('0.00');
    expect(satangToDecimalString(1n)).toBe('0.01');
    expect(decimalStringToSatang('3000.00')).toBe(300000n);
    expect(decimalStringToSatang('0.00')).toBe(0n);
    expect(decimalStringToSatang('0.01')).toBe(1n);
  });

  it('computes area times rate with half-up rounding to satang', () => {
    expect(areaRateToSatang('35.50', '85.25')).toBe(302638n);
    expect(areaRateToSatang('1', '0.005')).toBe(1n);
    expect(areaRateToSatang('1', '0.004')).toBe(0n);
    expect(areaRateToSatang('2.555', '1')).toBe(256n);
    expect(areaRateToSatang('2.545', '1')).toBe(255n);
  });

  it('parses wire money with THB only', () => {
    expect(parseMoneyWire({ amount: '3000.00', currency: 'THB' })).toBe(300000n);
    expect(() => parseMoneyWire({ amount: '3000.00', currency: 'USD' })).toThrowError(AppError);
    expect(() => parseMoneyWire({ amount: '3000.00', currency: 'THB' }).valueOf()).not.toThrow();
  });

  it('rejects non-canonical money strings', () => {
    for (const bad of ['3000', '3000.0', '3000.000', '03.00', '-1.00', '3,000.00', ' 3000.00', '3000.00 ', 'abc']) {
      expect(() => decimalStringToSatang(bad)).toThrowError(AppError);
    }
  });

  it('rejects satang overflow beyond int64', () => {
    expect(() => decimalStringToSatang('92233720368547758.08')).toThrowError(AppError);
    expect(decimalStringToSatang('92233720368547758.07')).toBe(INT64_MAX);
    expect(() => Money.fromSatang(INT64_MAX + 1n)).toThrowError(AppError);
  });

  it('adds, subtracts, and compares without floats', () => {
    const total = Money.fromWire({ amount: '3000.00', currency: 'THB' });
    const paid = Money.fromWire({ amount: '1200.50', currency: 'THB' });
    const outstanding = total.subtract(paid);
    expect(outstanding.toSatang()).toBe(179950n);
    expect(outstanding.toWire()).toEqual({ amount: '1799.50', currency: 'THB' });
    expect(total.add(paid).toSatang()).toBe(420050n);
    expect(total.compareTo(paid)).toBe(1);
    expect(paid.compareTo(total)).toBe(-1);
    expect(paid.compareTo(paid)).toBe(0);
    expect(Money.zero().isZero()).toBe(true);
    expect(total.isPositive()).toBe(true);
    expect(paid.subtract(total).isNegative()).toBe(true);
  });
});
