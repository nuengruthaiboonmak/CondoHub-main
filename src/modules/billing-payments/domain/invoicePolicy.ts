import type { InvoiceKind } from '../infrastructure/schema';

export type InvoiceListView = 'payable' | 'receivable';

export type InvoiceQueueAction =
  | 'VIEW'
  | 'SUBMIT_PAYMENT'
  | 'REVIEW_APPROVE'
  | 'REVIEW_REJECT'
  | 'EDIT'
  | 'VIEW_SLIP'
  | 'VIEW_QR'
  | 'VIEW_PAYEE';

export interface InvoiceAccessContext {
  kind: InvoiceKind;
  actorIsSystemAdmin: boolean;
  actorSuspended: boolean;
  actorMustChangePassword: boolean;
  inRentReviewerSnapshot: boolean;
  inFeeResponsibleSnapshot: boolean;
  tenantOverlap: boolean;
  activeResidentOfRoom: boolean;
  currentOwnerOfRoom: boolean;
  invoicePaid: boolean;
  pendingOnInvoice: boolean;
}

export type InvoiceAccessVerdict = { allowed: true } | { allowed: false; httpStatus: 403 | 404 };

export function evaluatePrivateRentAccess(
  context: InvoiceAccessContext,
  action: InvoiceQueueAction,
): InvoiceAccessVerdict {
  if (context.actorSuspended || context.actorMustChangePassword) {
    return { allowed: false, httpStatus: 403 };
  }
  if (context.actorIsSystemAdmin) return { allowed: false, httpStatus: 404 };
  if (!context.inRentReviewerSnapshot && !context.tenantOverlap) {
    return { allowed: false, httpStatus: 404 };
  }
  if (context.invoicePaid) {
    if (action === 'VIEW') return { allowed: true };
    if (action === 'REVIEW_REJECT' && context.pendingOnInvoice && context.inRentReviewerSnapshot) {
      return { allowed: true };
    }
    return { allowed: false, httpStatus: 404 };
  }
  if (action === 'VIEW' || action === 'SUBMIT_PAYMENT') {
    return context.inRentReviewerSnapshot || context.tenantOverlap
      ? { allowed: true }
      : { allowed: false, httpStatus: 404 };
  }
  if (action === 'REVIEW_APPROVE' || action === 'REVIEW_REJECT' || action === 'EDIT') {
    return context.inRentReviewerSnapshot ? { allowed: true } : { allowed: false, httpStatus: 404 };
  }
  if (action === 'VIEW_SLIP' || action === 'VIEW_PAYEE') {
    return context.inRentReviewerSnapshot || context.tenantOverlap
      ? { allowed: true }
      : { allowed: false, httpStatus: 404 };
  }
  return context.inRentReviewerSnapshot || context.tenantOverlap
    ? { allowed: true }
    : { allowed: false, httpStatus: 404 };
}

export function evaluateProjectRentAccess(
  context: InvoiceAccessContext,
  action: InvoiceQueueAction,
): InvoiceAccessVerdict {
  if (context.actorSuspended || context.actorMustChangePassword) {
    return { allowed: false, httpStatus: 403 };
  }
  if (context.actorIsSystemAdmin) {
    if (context.invoicePaid && action !== 'VIEW') {
      if (action === 'REVIEW_REJECT' && context.pendingOnInvoice) return { allowed: true };
      return { allowed: false, httpStatus: 403 };
    }
    return { allowed: true };
  }
  if (!context.tenantOverlap) return { allowed: false, httpStatus: 404 };
  if (context.invoicePaid) {
    return action === 'VIEW' ? { allowed: true } : { allowed: false, httpStatus: 403 };
  }
  if (
    action === 'VIEW' ||
    action === 'SUBMIT_PAYMENT' ||
    action === 'VIEW_SLIP' ||
    action === 'VIEW_QR' ||
    action === 'VIEW_PAYEE'
  ) {
    return { allowed: true };
  }
  return { allowed: false, httpStatus: 403 };
}

export function evaluateCommonFeeAccess(
  context: InvoiceAccessContext,
  action: InvoiceQueueAction,
): InvoiceAccessVerdict {
  if (context.actorSuspended || context.actorMustChangePassword) {
    return { allowed: false, httpStatus: 403 };
  }
  if (context.actorIsSystemAdmin) {
    if (context.invoicePaid && action !== 'VIEW') {
      if (action === 'REVIEW_REJECT' && context.pendingOnInvoice) return { allowed: true };
      return { allowed: false, httpStatus: 403 };
    }
    return { allowed: true };
  }
  if (
    !context.inFeeResponsibleSnapshot &&
    !context.activeResidentOfRoom &&
    !context.tenantOverlap
  ) {
    return { allowed: false, httpStatus: 404 };
  }
  if (context.invoicePaid) {
    return action === 'VIEW' ? { allowed: true } : { allowed: false, httpStatus: 403 };
  }
  if (
    action === 'VIEW' ||
    action === 'SUBMIT_PAYMENT' ||
    action === 'VIEW_SLIP' ||
    action === 'VIEW_QR' ||
    action === 'VIEW_PAYEE'
  ) {
    return { allowed: true };
  }
  return { allowed: false, httpStatus: 403 };
}

export function evaluateInvoiceAccess(
  context: InvoiceAccessContext,
  action: InvoiceQueueAction,
): InvoiceAccessVerdict {
  if (context.kind === 'PRIVATE_RENT') return evaluatePrivateRentAccess(context, action);
  if (context.kind === 'PROJECT_MANAGED_RENT') {
    return evaluateProjectRentAccess(context, action);
  }
  return evaluateCommonFeeAccess(context, action);
}

export function membershipOverlapsServicePeriod(input: {
  membershipStart: Date;
  membershipEnd: Date | null;
  serviceStart: Date;
  serviceEndExclusive: Date;
}): boolean {
  const membershipEndMs =
    input.membershipEnd === null ? Number.POSITIVE_INFINITY : input.membershipEnd.getTime();
  return (
    input.membershipStart.getTime() < input.serviceEndExclusive.getTime() &&
    membershipEndMs > input.serviceStart.getTime()
  );
}

export function allowedInvoiceKinds(actorIsSystemAdmin: boolean): InvoiceKind[] {
  return actorIsSystemAdmin
    ? ['PROJECT_MANAGED_RENT', 'COMMON_FEE']
    : ['PRIVATE_RENT', 'PROJECT_MANAGED_RENT', 'COMMON_FEE'];
}
