import { describe, expect, it } from 'vitest';
import { feeAmountSatang, oneTimeAmountSatang, rentAmountSatang } from './feeCalc';

describe('UT-BL-03 common fee modes', () => {
  it('computes fixed project fees from the rate string', () => {
    expect(
      feeAmountSatang({ configMode: 'FIXED_PROJECT', rate: '3000.00', roomAreaSqm: '35.50' }),
    ).toBe(300000n);
  });

  it('computes per-room fees from the rate string', () => {
    expect(
      feeAmountSatang({ configMode: 'PER_ROOM', rate: '1250.50', roomAreaSqm: '28.00' }),
    ).toBe(125050n);
  });

  it('computes area fees with half-up rounding once', () => {
    expect(
      feeAmountSatang({ configMode: 'AREA', rate: '55.00', roomAreaSqm: '35.50' }),
    ).toBe(195250n);
  });

  it('rounds area products half-up at the satang boundary', () => {
    expect(
      feeAmountSatang({ configMode: 'AREA', rate: '1.00', roomAreaSqm: '0.005' }),
    ).toBe(1n);
    expect(
      feeAmountSatang({ configMode: 'AREA', rate: '1.00', roomAreaSqm: '0.004' }),
    ).toBe(0n);
  });

  it('rejects missing rates for every mode', () => {
    expect(() => feeAmountSatang({ configMode: 'AREA', rate: null, roomAreaSqm: '35.50' })).toThrowError();
    expect(() =>
      feeAmountSatang({ configMode: 'FIXED_PROJECT', rate: null, roomAreaSqm: '35.50' }),
    ).toThrowError();
    expect(() =>
      feeAmountSatang({ configMode: 'PER_ROOM', rate: null, roomAreaSqm: '35.50' }),
    ).toThrowError();
  });

  it('computes rent from the monthly rate', () => {
    expect(rentAmountSatang('12000.00')).toBe(1200000n);
    expect(() => rentAmountSatang(null)).toThrowError();
  });
});

describe('UT-BL-03A one-time amounts', () => {
  it('prefers the configured amount when present', () => {
    expect(oneTimeAmountSatang(300000n, null)).toBe(300000n);
  });

  it('falls back to the rule calculation when no amount is configured', () => {
    expect(
      oneTimeAmountSatang(null, { configMode: 'FIXED_PROJECT', rate: '3000.00', roomAreaSqm: '30.00' }),
    ).toBe(300000n);
  });

  it('rejects a one-time charge with neither amount nor fallback', () => {
    expect(() => oneTimeAmountSatang(null, null)).toThrowError();
  });
});
