import { describe, expect, it } from 'vitest';
import { buildPayeeSnapshot, payeeSnapshotToRecord, systemAutoPayee } from './payeePolicy';

describe('S6 payee-confirm input policy', () => {
  it('builds a snapshot when confirmation is present', () => {
    const snapshot = buildPayeeSnapshot({
      bankName: 'Example Bank',
      accountName: 'Example Owner',
      accountNumber: '1234567890',
      confirmed: true,
    });
    expect(snapshot.qrImageId).toBeNull();
    expect(payeeSnapshotToRecord(snapshot)).toEqual({
      bankName: 'Example Bank',
      accountName: 'Example Owner',
      accountNumber: '1234567890',
      qrImageId: null,
    });
  });

  it('requires explicit confirmation', () => {
    expect(() =>
      buildPayeeSnapshot({
        bankName: 'Example Bank',
        accountName: 'Example Owner',
        accountNumber: '1234567890',
        confirmed: false,
      }),
    ).toThrowError();
  });

  it('rejects blank payee fields', () => {
    expect(() =>
      buildPayeeSnapshot({ bankName: ' ', accountName: 'Name', accountNumber: '1', confirmed: true }),
    ).toThrowError();
  });

  it('provides a system auto payee for recurring generation', () => {
    expect(systemAutoPayee().accountNumber).toBe('SYSTEM-AUTO');
  });
});
