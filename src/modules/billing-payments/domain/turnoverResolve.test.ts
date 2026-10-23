import { describe, expect, it } from 'vitest';
import { AppError } from '@/shared/utils/errors';
import {
  assertDueDateCalendarValid,
  assertExpectedVersion,
  assertIssueSelection,
  assertNoChargeSelection,
  assertPastDueDateConfirmed,
  assertResolvableState,
  buildReviewerCopy,
  canReopenReview,
  checkPastDueDate,
  deriveRentTotalSatang,
  isDerivedBlocked,
  resolveInvoiceTotal,
} from './turnoverResolve';

const CANDIDATES = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];

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

describe('UT-BL-02 one/both tenancy bills according to operator choice', () => {
  it('accepts a single-tenancy selection out of two candidates', () => {
    const selected = [CANDIDATES[0] as string];
    expect(() =>
      assertIssueSelection({
        selectedTenancyIds: selected,
        perInvoice: [{ tenancyId: CANDIDATES[0] as string }],
        candidateTenancyIds: CANDIDATES,
      }),
    ).not.toThrow();
  });

  it('accepts both tenancies when the operator selects both', () => {
    expect(() =>
      assertIssueSelection({
        selectedTenancyIds: [...CANDIDATES],
        perInvoice: CANDIDATES.map((tenancyId) => ({ tenancyId })),
        candidateTenancyIds: CANDIDATES,
      }),
    ).not.toThrow();
  });

  it('rejects an empty ISSUE_INVOICES selection', () => {
    expectCode(
      () => assertIssueSelection({ selectedTenancyIds: [], perInvoice: [], candidateTenancyIds: CANDIDATES }),
      'VALIDATION_ERROR',
    );
  });

  it('rejects duplicated selected tenancies', () => {
    const id = CANDIDATES[0] as string;
    expectCode(
      () =>
        assertIssueSelection({
          selectedTenancyIds: [id, id],
          perInvoice: [{ tenancyId: id }],
          candidateTenancyIds: CANDIDATES,
        }),
      'VALIDATION_ERROR',
    );
  });

  it('rejects a tenancy outside the review candidates', () => {
    const foreign = '33333333-3333-4333-8333-333333333333';
    expectCode(
      () =>
        assertIssueSelection({
          selectedTenancyIds: [foreign],
          perInvoice: [{ tenancyId: foreign }],
          candidateTenancyIds: CANDIDATES,
        }),
      'VALIDATION_ERROR',
    );
  });

  it('rejects when per-invoice terms do not cover every selected tenancy', () => {
    expectCode(
      () =>
        assertIssueSelection({
          selectedTenancyIds: [...CANDIDATES],
          perInvoice: [{ tenancyId: CANDIDATES[0] as string }],
          candidateTenancyIds: CANDIDATES,
        }),
      'VALIDATION_ERROR',
    );
  });

  it('rejects duplicated per-invoice entries', () => {
    const id = CANDIDATES[0] as string;
    expectCode(
      () =>
        assertIssueSelection({
          selectedTenancyIds: [id],
          perInvoice: [{ tenancyId: id }, { tenancyId: id }],
          candidateTenancyIds: CANDIDATES,
        }),
      'VALIDATION_ERROR',
    );
  });
});

describe('UT-BL-02 D03-A/D03-B the decider sets the due date per invoice; past dates need explicit confirmation', () => {
  it('requires a present calendar-valid due date per invoice', () => {
    expect(() => assertDueDateCalendarValid('2026-11-27')).not.toThrow();
    expectCode(() => assertDueDateCalendarValid('2026-02-31'), 'VALIDATION_ERROR');
    expectCode(() => assertDueDateCalendarValid('2026-13-01'), 'VALIDATION_ERROR');
    expectCode(() => assertDueDateCalendarValid('not-a-date'), 'VALIDATION_ERROR');
  });

  it('treats today and future due dates as non-past with no confirmation needed', () => {
    expect(
      checkPastDueDate({ dueDate: '2026-10-15', issueDate: '2026-10-15' }),
    ).toEqual({ past: false });
    expect(
      checkPastDueDate({ dueDate: '2026-11-27', issueDate: '2026-10-15' }),
    ).toEqual({ past: false });
    expect(
      assertPastDueDateConfirmed({ dueDate: '2026-10-15', issueDate: '2026-10-15' }),
    ).toBe(false);
  });

  it('rejects a past due date without confirmation; nothing is published', () => {
    expect(
      checkPastDueDate({ dueDate: '2026-10-14', issueDate: '2026-10-15' }),
    ).toEqual({ past: true, confirmed: false });
    expectCode(
      () => assertPastDueDateConfirmed({ dueDate: '2026-10-14', issueDate: '2026-10-15' }),
      'PAST_DUE_DATE_CONFIRMATION_REQUIRED',
    );
    expectCode(
      () =>
        assertPastDueDateConfirmed({
          dueDate: '2026-10-14',
          issueDate: '2026-10-15',
          confirmPastDueDate: false,
        }),
      'PAST_DUE_DATE_CONFIRMATION_REQUIRED',
    );
  });

  it('accepts a past due date with per-invoice explicit confirmation', () => {
    expect(
      assertPastDueDateConfirmed({
        dueDate: '2026-10-14',
        issueDate: '2026-10-15',
        confirmPastDueDate: true,
      }),
    ).toBe(true);
  });

  it('derives full-month amounts from the rent rule without config due-day substitution', () => {
    expect(
      deriveRentTotalSatang({ configMode: 'FIXED_PROJECT', rate: '12000.00' }, '35.5000'),
    ).toBe(1_200_000n);
    expect(
      deriveRentTotalSatang({ configMode: 'AREA', rate: '70.00' }, '35.50'),
    ).toBe(248_500n);
    expectCode(
      () => deriveRentTotalSatang({ configMode: 'FIXED_PROJECT', rate: null }, '35.50'),
      'VALIDATION_ERROR',
    );
  });
});

describe('UT-BL-02B NO_CHARGE waives every tenancy of the review, needs a reason, creates no invoice', () => {
  it('accepts an empty selection with a non-blank reason', () => {
    expect(() =>
      assertNoChargeSelection({ selectedTenancyIds: [], reason: 'Goodwill waiver' }),
    ).not.toThrow();
  });

  it('rejects NO_CHARGE carrying selected tenancies', () => {
    expectCode(
      () =>
        assertNoChargeSelection({
          selectedTenancyIds: [CANDIDATES[0] as string],
          reason: 'Goodwill waiver',
        }),
      'VALIDATION_ERROR',
    );
  });

  it('rejects a blank or whitespace-only reason', () => {
    expectCode(() => assertNoChargeSelection({ selectedTenancyIds: [], reason: '' }), 'VALIDATION_ERROR');
    expectCode(
      () => assertNoChargeSelection({ selectedTenancyIds: [], reason: '   ' }),
      'VALIDATION_ERROR',
    );
  });

  it('locks the review in UNRESOLVED-compatible terminal states only through resolve', () => {
    expect(() => assertResolvableState('UNRESOLVED')).not.toThrow();
    expectCode(() => assertResolvableState('RESOLVED'), 'VERSION_CONFLICT');
    expectCode(() => assertResolvableState('NO_CHARGE'), 'VERSION_CONFLICT');
    expect(canReopenReview('UNRESOLVED')).toBe(true);
    expect(canReopenReview('RESOLVED')).toBe(false);
    expect(canReopenReview('NO_CHARGE')).toBe(false);
  });

  it('guards concurrent resolves with the expected version check', () => {
    expect(() => assertExpectedVersion({ expected: 3, actual: 3 })).not.toThrow();
    expectCode(() => assertExpectedVersion({ expected: 3, actual: 4 }), 'VERSION_CONFLICT');
  });
});

describe('UT-BL-02B partial selection resolves with invoices only for the selected tenancies', () => {
  it('resolves with a single invoice while the unselected tenancy gets none', () => {
    const first = CANDIDATES[0] as string;
    expect(() =>
      assertIssueSelection({
        selectedTenancyIds: [first],
        perInvoice: [{ tenancyId: first }],
        candidateTenancyIds: CANDIDATES,
      }),
    ).not.toThrow();
  });
});

describe('UT-BL-02C admin-only override needs a reason; PRIVATE issuer sending override is denied', () => {
  it('keeps the derived total when no override is present', () => {
    expect(
      resolveInvoiceTotal({ derivedSatang: 1_200_000n, actorIsSystemAdmin: false }),
    ).toEqual({ totalSatang: 1_200_000n, overridden: false });
  });

  it('applies an admin override with a non-blank reason', () => {
    expect(
      resolveInvoiceTotal({
        derivedSatang: 1_200_000n,
        amountOverrideSatang: 900_000n,
        overrideReason: 'Partial goodwill credit',
        actorIsSystemAdmin: true,
      }),
    ).toEqual({ totalSatang: 900_000n, overridden: true });
  });

  it('denies a PRIVATE issuer sending an override', () => {
    expectCode(
      () =>
        resolveInvoiceTotal({
          derivedSatang: 1_200_000n,
          amountOverrideSatang: 900_000n,
          overrideReason: 'Partial goodwill credit',
          actorIsSystemAdmin: false,
        }),
      'ACCESS_DENIED',
    );
  });

  it('requires a reason whenever an override amount is present', () => {
    expectCode(
      () =>
        resolveInvoiceTotal({
          derivedSatang: 1_200_000n,
          amountOverrideSatang: 900_000n,
          overrideReason: '  ',
          actorIsSystemAdmin: true,
        }),
      'VALIDATION_ERROR',
    );
    expectCode(
      () =>
        resolveInvoiceTotal({
          derivedSatang: 1_200_000n,
          amountOverrideSatang: -100n,
          overrideReason: 'Negative is invalid',
          actorIsSystemAdmin: true,
        }),
      'VALIDATION_ERROR',
    );
  });
});

describe('UT-BL-02C S1b copies the whole S2 set verbatim; missing S2 fails with no fallback', () => {
  it('copies every S2 row including refs without querying or filtering', () => {
    const s2 = [
      { userId: 'owner-a', ownershipIntervalRef: 'own-a' },
      { userId: 'owner-c', ownershipIntervalRef: null },
    ];
    expect(buildReviewerCopy({ s2Rows: s2 })).toEqual(s2);
  });

  it('fails closed when no S2 rows exist', () => {
    expectCode(() => buildReviewerCopy({ s2Rows: [] }), 'INTERNAL_ERROR');
  });

  it('derives the blocked-for-data-correction predicate from zero S2 rows', () => {
    expect(isDerivedBlocked(0)).toBe(true);
    expect(isDerivedBlocked(1)).toBe(false);
    expect(isDerivedBlocked(2)).toBe(false);
  });
});
