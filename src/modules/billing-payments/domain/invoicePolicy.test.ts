import { describe, expect, it } from 'vitest';
import {
  allowedInvoiceKinds,
  evaluateCommonFeeAccess,
  evaluateInvoiceAccess,
  evaluatePrivateRentAccess,
  evaluateProjectRentAccess,
  membershipOverlapsServicePeriod,
  type InvoiceAccessContext,
} from './invoicePolicy';

function base(kind: InvoiceAccessContext['kind']): InvoiceAccessContext {
  return {
    kind,
    actorIsSystemAdmin: false,
    actorSuspended: false,
    actorMustChangePassword: false,
    inRentReviewerSnapshot: false,
    inFeeResponsibleSnapshot: false,
    tenantOverlap: false,
    activeResidentOfRoom: false,
    currentOwnerOfRoom: false,
    invoicePaid: false,
    pendingOnInvoice: false,
  };
}

describe('UT-BL-05 Pending Slip preserved after Invoice Edit with PAID plus Pending Slip in the reviewer queue', () => {
  it('keeps the reviewer approve path open while a pending slip rides an edit', () => {
    const context = { ...base('PRIVATE_RENT'), inRentReviewerSnapshot: true };
    expect(evaluatePrivateRentAccess(context, 'REVIEW_APPROVE')).toEqual({ allowed: true });
    expect(evaluatePrivateRentAccess(context, 'REVIEW_REJECT')).toEqual({ allowed: true });
  });

  it('refuses further approvals once the edited invoice is PAID with a pending slip', () => {
    const context = {
      ...base('PRIVATE_RENT'),
      inRentReviewerSnapshot: true,
      invoicePaid: true,
      pendingOnInvoice: true,
    };
    expect(evaluatePrivateRentAccess(context, 'REVIEW_APPROVE')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(evaluatePrivateRentAccess(context, 'SUBMIT_PAYMENT')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
  });

  it('lets admins reject-only the pending slip on PAID project and fee invoices', () => {
    const project = {
      ...base('PROJECT_MANAGED_RENT'),
      actorIsSystemAdmin: true,
      invoicePaid: true,
      pendingOnInvoice: true,
    };
    expect(evaluateProjectRentAccess(project, 'REVIEW_REJECT')).toEqual({ allowed: true });
    expect(evaluateProjectRentAccess(project, 'REVIEW_APPROVE')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
    const fee = {
      ...base('COMMON_FEE'),
      actorIsSystemAdmin: true,
      invoicePaid: true,
      pendingOnInvoice: true,
    };
    expect(evaluateCommonFeeAccess(fee, 'REVIEW_REJECT')).toEqual({ allowed: true });
    expect(evaluateCommonFeeAccess(fee, 'EDIT')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
    const settled = {
      ...base('COMMON_FEE'),
      actorIsSystemAdmin: true,
      invoicePaid: true,
      pendingOnInvoice: false,
    };
    expect(evaluateCommonFeeAccess(settled, 'REVIEW_REJECT')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
  });
});

describe('UT-BL-06 Verify Permission Private Owner-managed (D02 Reviewer Snapshot) vs Project-managed Rent vs Common Fee Admin, Former Tenant Visibility', () => {
  it('grants private review to snapshot reviewers and denies project tenants', () => {
    const reviewer = { ...base('PRIVATE_RENT'), inRentReviewerSnapshot: true };
    expect(evaluatePrivateRentAccess(reviewer, 'REVIEW_APPROVE')).toEqual({ allowed: true });
    const tenant = { ...base('PRIVATE_RENT'), tenantOverlap: true };
    expect(evaluatePrivateRentAccess(tenant, 'VIEW')).toEqual({ allowed: true });
    expect(evaluatePrivateRentAccess(tenant, 'REVIEW_APPROVE')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
  });

  it('grants project-managed review to admins while tenants only view and pay', () => {
    const admin = { ...base('PROJECT_MANAGED_RENT'), actorIsSystemAdmin: true };
    expect(evaluateProjectRentAccess(admin, 'REVIEW_APPROVE')).toEqual({ allowed: true });
    expect(evaluateProjectRentAccess(admin, 'EDIT')).toEqual({ allowed: true });
    const tenant = { ...base('PROJECT_MANAGED_RENT'), tenantOverlap: true };
    expect(evaluateProjectRentAccess(tenant, 'SUBMIT_PAYMENT')).toEqual({ allowed: true });
    expect(evaluateProjectRentAccess(tenant, 'REVIEW_APPROVE')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
  });

  it('grants common-fee review to admins while snapshot owners only view and pay', () => {
    const admin = { ...base('COMMON_FEE'), actorIsSystemAdmin: true };
    expect(evaluateCommonFeeAccess(admin, 'REVIEW_REJECT')).toEqual({ allowed: true });
    const owner = { ...base('COMMON_FEE'), inFeeResponsibleSnapshot: true };
    expect(evaluateCommonFeeAccess(owner, 'SUBMIT_PAYMENT')).toEqual({ allowed: true });
    expect(evaluateCommonFeeAccess(owner, 'REVIEW_APPROVE')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
  });

  it('keeps former tenants on their own tenancy debt without reviewer rights', () => {
    const former = { ...base('PROJECT_MANAGED_RENT'), tenantOverlap: true };
    expect(evaluateProjectRentAccess(former, 'VIEW')).toEqual({ allowed: true });
    expect(evaluateProjectRentAccess(former, 'EDIT')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
  });
});

describe('UT-BL-07 D02 Snapshot includes all A/B co-owners at issuing, current owner C not granted old Invoice access', () => {
  it('lets A/B view, verify, and edit while unpaid after transfer', () => {
    const reviewer = { ...base('PRIVATE_RENT'), inRentReviewerSnapshot: true };
    expect(evaluatePrivateRentAccess(reviewer, 'VIEW')).toEqual({ allowed: true });
    expect(evaluatePrivateRentAccess(reviewer, 'REVIEW_REJECT')).toEqual({ allowed: true });
    expect(evaluatePrivateRentAccess(reviewer, 'EDIT')).toEqual({ allowed: true });
  });

  it('denies current owner C without ever confirming the old invoice', () => {
    const currentOwner = { ...base('PRIVATE_RENT'), currentOwnerOfRoom: true };
    expect(evaluatePrivateRentAccess(currentOwner, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(evaluatePrivateRentAccess(currentOwner, 'VIEW_SLIP')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(evaluatePrivateRentAccess(currentOwner, 'VIEW_QR')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
  });

  it('holds PAID read-only with PENDING-on-PAID reject only', () => {
    const reviewer = {
      ...base('PRIVATE_RENT'),
      inRentReviewerSnapshot: true,
      invoicePaid: true,
      pendingOnInvoice: true,
    };
    expect(evaluatePrivateRentAccess(reviewer, 'VIEW')).toEqual({ allowed: true });
    expect(evaluatePrivateRentAccess(reviewer, 'REVIEW_REJECT')).toEqual({ allowed: true });
    expect(evaluatePrivateRentAccess(reviewer, 'REVIEW_APPROVE')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(evaluatePrivateRentAccess(reviewer, 'EDIT')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
  });

  it('denies SUSPENDED snapshot reviewers on every action', () => {
    const suspended = {
      ...base('PRIVATE_RENT'),
      inRentReviewerSnapshot: true,
      actorSuspended: true,
    };
    expect(evaluatePrivateRentAccess(suspended, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
    expect(evaluatePrivateRentAccess(suspended, 'REVIEW_REJECT')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
  });

  it('matches slip and QR image ACL exactly to the invoice policy', () => {
    const reviewer = { ...base('PRIVATE_RENT'), inRentReviewerSnapshot: true };
    const tenant = { ...base('PRIVATE_RENT'), tenantOverlap: true };
    const outsider = { ...base('PRIVATE_RENT') };
    for (const action of ['VIEW_SLIP', 'VIEW_QR'] as const) {
      expect(evaluatePrivateRentAccess(reviewer, action)).toEqual({ allowed: true });
      expect(evaluatePrivateRentAccess(tenant, action)).toEqual({ allowed: true });
      expect(evaluatePrivateRentAccess(outsider, action)).toEqual({
        allowed: false,
        httpStatus: 404,
      });
    }
  });
});

describe('UT-BL-08 D04-A APPROVED: membership and service-period overlap under [start,end)', () => {
  const serviceStart = new Date('2026-04-01T00:00:00+07:00');
  const serviceEndExclusive = new Date('2026-05-01T00:00:00+07:00');

  it('admits B joining 15 April to the April invoice', () => {
    expect(
      membershipOverlapsServicePeriod({
        membershipStart: new Date('2026-04-15T00:00:00+07:00'),
        membershipEnd: null,
        serviceStart,
        serviceEndExclusive,
      }),
    ).toBe(true);
  });

  it('denies January through March invoices even when issued after B joins', () => {
    const januaryStart = new Date('2026-01-01T00:00:00+07:00');
    const januaryEnd = new Date('2026-02-01T00:00:00+07:00');
    expect(
      membershipOverlapsServicePeriod({
        membershipStart: new Date('2026-04-15T00:00:00+07:00'),
        membershipEnd: null,
        serviceStart: januaryStart,
        serviceEndExclusive: januaryEnd,
      }),
    ).toBe(false);
  });

  it('keeps B on April through June after a June move-out while July stays denied', () => {
    const juneStart = new Date('2026-06-01T00:00:00+07:00');
    const juneEnd = new Date('2026-07-01T00:00:00+07:00');
    const julyStart = new Date('2026-07-01T00:00:00+07:00');
    const julyEnd = new Date('2026-08-01T00:00:00+07:00');
    const movedOut = new Date('2026-06-20T00:00:00+07:00');
    expect(
      membershipOverlapsServicePeriod({
        membershipStart: new Date('2026-04-15T00:00:00+07:00'),
        membershipEnd: movedOut,
        serviceStart: juneStart,
        serviceEndExclusive: juneEnd,
      }),
    ).toBe(true);
    expect(
      membershipOverlapsServicePeriod({
        membershipStart: new Date('2026-04-15T00:00:00+07:00'),
        membershipEnd: movedOut,
        serviceStart: julyStart,
        serviceEndExclusive: julyEnd,
      }),
    ).toBe(false);
  });

  it('treats touching boundaries as non-overlapping under [start,end)', () => {
    expect(
      membershipOverlapsServicePeriod({
        membershipStart: new Date('2026-05-01T00:00:00+07:00'),
        membershipEnd: null,
        serviceStart,
        serviceEndExclusive,
      }),
    ).toBe(false);
    expect(
      membershipOverlapsServicePeriod({
        membershipStart: new Date('2026-03-01T00:00:00+07:00'),
        membershipEnd: new Date('2026-04-01T00:00:00+07:00'),
        serviceStart,
        serviceEndExclusive,
      }),
    ).toBe(false);
  });

  it('evaluates list and detail and submit and slip and QR through the same predicate', () => {
    const tenant = { ...base('PRIVATE_RENT'), tenantOverlap: true };
    for (const action of ['VIEW', 'SUBMIT_PAYMENT', 'VIEW_SLIP', 'VIEW_QR'] as const) {
      expect(evaluatePrivateRentAccess(tenant, action)).toEqual({ allowed: true });
    }
    const stranger = { ...base('PRIVATE_RENT') };
    for (const action of ['VIEW', 'SUBMIT_PAYMENT', 'VIEW_SLIP', 'VIEW_QR'] as const) {
      expect(evaluatePrivateRentAccess(stranger, action)).toEqual({
        allowed: false,
        httpStatus: 404,
      });
    }
  });

  it('denies suspended tenants even when the membership window overlaps', () => {
    const suspended = {
      ...base('PRIVATE_RENT'),
      tenantOverlap: true,
      actorSuspended: true,
    };
    expect(evaluatePrivateRentAccess(suspended, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
    expect(evaluatePrivateRentAccess(suspended, 'SUBMIT_PAYMENT')).toEqual({
      allowed: false,
      httpStatus: 403,
    });
  });
});

describe('UT-BL-09 D06-A: System Admin PRIVATE_RENT denied on every endpoint with mixed-kind aggregates scoped before SUM/COUNT/Pagination', () => {
  it('denies admins every private action without confirming existence', () => {
    const admin = { ...base('PRIVATE_RENT'), actorIsSystemAdmin: true };
    for (const action of [
      'VIEW',
      'SUBMIT_PAYMENT',
      'REVIEW_APPROVE',
      'REVIEW_REJECT',
      'EDIT',
      'VIEW_SLIP',
      'VIEW_QR',
      'VIEW_PAYEE',
    ] as const) {
      expect(evaluateInvoiceAccess(admin, action)).toEqual({
        allowed: false,
        httpStatus: 404,
      });
    }
  });

  it('scopes admin list and count kinds to project-managed rent and common fee only', () => {
    expect(allowedInvoiceKinds(true)).toEqual(['PROJECT_MANAGED_RENT', 'COMMON_FEE']);
    expect(allowedInvoiceKinds(false)).toEqual([
      'PRIVATE_RENT',
      'PROJECT_MANAGED_RENT',
      'COMMON_FEE',
    ]);
  });

  it('keeps D02 snapshot reviewers and D04 tenants working while admins read the other kinds', () => {
    const reviewer = { ...base('PRIVATE_RENT'), inRentReviewerSnapshot: true };
    expect(evaluatePrivateRentAccess(reviewer, 'VIEW')).toEqual({ allowed: true });
    const tenant = { ...base('PRIVATE_RENT'), tenantOverlap: true };
    expect(evaluatePrivateRentAccess(tenant, 'SUBMIT_PAYMENT')).toEqual({ allowed: true });
    const adminProject = { ...base('PROJECT_MANAGED_RENT'), actorIsSystemAdmin: true };
    expect(evaluateProjectRentAccess(adminProject, 'VIEW')).toEqual({ allowed: true });
    const adminFee = { ...base('COMMON_FEE'), actorIsSystemAdmin: true };
    expect(evaluateCommonFeeAccess(adminFee, 'REVIEW_APPROVE')).toEqual({ allowed: true });
  });

  it('never opens rent ACL through room ownership management alone', () => {
    const ownerOnly = { ...base('PRIVATE_RENT'), currentOwnerOfRoom: true };
    expect(evaluatePrivateRentAccess(ownerOnly, 'VIEW')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
    expect(evaluatePrivateRentAccess(ownerOnly, 'REVIEW_APPROVE')).toEqual({
      allowed: false,
      httpStatus: 404,
    });
  });
});
