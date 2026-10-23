import { describe, expect, it } from 'vitest';
import { AppError } from '@/shared/utils/errors';
import {
  assertApprovable,
  assertEditableTotal,
  deriveInvoiceState,
  isOverdue,
  outstandingSatang,
} from './paymentState';

function expectCode(fn: () => void, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error('Expected the guard to throw.');
}

describe('UT-BL-04 Partial Approvals, Outstanding/Status', () => {
  it('walks invoice 1000 through approve 300 then 200 then 500 to PAID', () => {
    const total = 100000n;
    expect(deriveInvoiceState(total, 0n)).toBe('UNPAID');
    expect(outstandingSatang(total, 0n)).toBe(100000n);
    expect(deriveInvoiceState(total, 30000n)).toBe('PARTIALLY_PAID');
    expect(outstandingSatang(total, 30000n)).toBe(70000n);
    expect(deriveInvoiceState(total, 50000n)).toBe('PARTIALLY_PAID');
    expect(outstandingSatang(total, 50000n)).toBe(50000n);
    expect(deriveInvoiceState(total, 100000n)).toBe('PAID');
    expect(outstandingSatang(total, 100000n)).toBe(0n);
  });

  it('derives status from approved totals rather than any stored state', () => {
    expect(deriveInvoiceState(120000n, 0n)).toBe('UNPAID');
    expect(deriveInvoiceState(120000n, 1n)).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceState(120000n, 119999n)).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceState(120000n, 120000n)).toBe('PAID');
  });

  it('flags OVERDUE from date plus outstanding with no penalty state', () => {
    expect(
      isOverdue({ projectToday: '2026-10-16', dueDate: '2026-10-15', outstandingSatang: 1n }),
    ).toBe(true);
    expect(
      isOverdue({ projectToday: '2026-10-15', dueDate: '2026-10-15', outstandingSatang: 1n }),
    ).toBe(false);
    expect(
      isOverdue({ projectToday: '2026-10-16', dueDate: '2026-10-15', outstandingSatang: 0n }),
    ).toBe(false);
  });
});

describe('UT-BL-04 zero/over/out-of-range Approval Rejected', () => {
  it('rejects zero and negative approvals without touching derived totals', () => {
    expectCode(
      () => assertApprovable({ amountSatang: 0n, outstandingSatang: 70000n }),
      'VALIDATION_ERROR',
    );
    expectCode(
      () => assertApprovable({ amountSatang: -100n, outstandingSatang: 70000n }),
      'VALIDATION_ERROR',
    );
  });

  it('rejects approvals beyond the current outstanding', () => {
    expectCode(
      () => assertApprovable({ amountSatang: 70001n, outstandingSatang: 70000n }),
      'PAYMENT_APPROVED_AMOUNT_EXCEEDS_OUTSTANDING',
    );
  });

  it('accepts approvals up to and including the full outstanding', () => {
    expect(() =>
      assertApprovable({ amountSatang: 1n, outstandingSatang: 70000n }),
    ).not.toThrow();
    expect(() =>
      assertApprovable({ amountSatang: 70000n, outstandingSatang: 70000n }),
    ).not.toThrow();
  });
});

describe('UT-BL-05 Total Floor at Approved Sum', () => {
  it('rejects lowering the total below the approved sum', () => {
    expectCode(
      () =>
        assertEditableTotal({
          invoicePaid: false,
          approvedTotalSatang: 70000n,
          newTotalSatang: 60000n,
        }),
      'VALIDATION_ERROR',
    );
  });

  it('allows editing the total down to exactly the approved sum', () => {
    expect(() =>
      assertEditableTotal({
        invoicePaid: false,
        approvedTotalSatang: 70000n,
        newTotalSatang: 70000n,
      }),
    ).not.toThrow();
  });

  it('locks PAID invoices against further edits', () => {
    expectCode(
      () =>
        assertEditableTotal({
          invoicePaid: true,
          approvedTotalSatang: 100000n,
          newTotalSatang: 110000n,
        }),
      'INVOICE_ALREADY_PAID',
    );
  });
});
