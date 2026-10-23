import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { satangToDecimalString } from '@/shared/utils/money';
import { moneyWireBodyToSatang, type MoneyWireBody } from '@/shared/utils/moneySchema';
import { hashRequestBody } from '@/shared/utils/idempotency';
import { formatProjectDate, projectDateParts } from '@/shared/utils/clock';
import { writeAudit } from '@/shared/observability/audit';
import { evaluateInvoiceAccess } from '../domain/invoicePolicy';
import {
  assertApprovable,
  assertReviewTransition,
  deriveInvoiceState,
  isOverdue,
  outstandingSatang,
  type DerivedInvoiceState,
} from '../domain/paymentState';
import {
  findInvoiceById,
  isFeeResponsibleOwner,
  isInvoiceMemberVisible,
  isRentReviewer,
  lockInvoiceForUpdate,
  readInvoiceBalance,
  tenantOverlapsInvoice,
} from '../infrastructure/invoiceRepository';
import {
  approvePendingSubmission,
  findSubmissionById,
  lockSubmissionForUpdate,
  rejectPendingSubmission,
  type PaymentSubmissionRecord,
} from '../infrastructure/paymentSubmissionRepository';
import {
  getPaymentReviewIdempotencyRecord,
  upsertPaymentReviewIdempotencyRecord,
} from './paymentReviewIdempotency';
import { listMembershipWindowsByUser } from '@/modules/property-membership/application/index';
import type { BillingCtx } from './ctx';

export interface ApproveSubmissionInput {
  amount: MoneyWireBody;
  idempotencyKey?: string | undefined;
}

export interface RejectSubmissionInput {
  reason: string;
  idempotencyKey?: string | undefined;
}

export interface ReviewSubmissionDto {
  id: string;
  invoiceId: string;
  state: 'APPROVED' | 'REJECTED';
  approvedAmount: { amount: string; currency: 'THB' } | null;
  reviewedBy: string;
  reviewedAt: string;
  rejectReason: string | null;
  invoiceState: DerivedInvoiceState;
  outstanding: { amount: string; currency: 'THB' };
  overdue: boolean;
  pendingOnPaid: boolean;
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

function toReviewDto(input: {
  submission: PaymentSubmissionRecord;
  invoiceTotal: bigint;
  approvedTotal: bigint;
  snapshotTimezone: string;
  dueDate: string;
  now: Date;
  pendingCount: number;
}): ReviewSubmissionDto {
  const outstanding = outstandingSatang(input.invoiceTotal, input.approvedTotal);
  const invoiceState = deriveInvoiceState(input.invoiceTotal, input.approvedTotal);
  const today = formatProjectDate(projectDateParts(input.now, input.snapshotTimezone));
  if (input.submission.reviewedBy === null || input.submission.reviewedAt === null) {
    throw new AppError('INTERNAL_ERROR', 'The reviewed submission is missing review metadata.');
  }
  if (input.submission.state !== 'APPROVED' && input.submission.state !== 'REJECTED') {
    throw new AppError('INTERNAL_ERROR', 'The submission replay is not in a terminal state.');
  }
  return {
    id: input.submission.id,
    invoiceId: input.submission.invoiceId,
    state: input.submission.state,
    approvedAmount:
      input.submission.approvedAmount === null
        ? null
        : { amount: satangToDecimalString(input.submission.approvedAmount), currency: 'THB' },
    reviewedBy: input.submission.reviewedBy,
    reviewedAt: input.submission.reviewedAt.toISOString(),
    rejectReason: input.submission.rejectReason,
    invoiceState,
    outstanding: { amount: satangToDecimalString(outstanding), currency: 'THB' },
    overdue: isOverdue({
      projectToday: today,
      dueDate: input.dueDate,
      outstandingSatang: outstanding,
    }),
    pendingOnPaid: invoiceState === 'PAID' && input.pendingCount > 0,
  };
}

async function assertReviewerVisible(
  conn: Db,
  actor: Actor,
  submission: PaymentSubmissionRecord,
  at: Date,
): Promise<void> {
  if (actor.isSystemAdmin) {
    const row = await findInvoiceById(conn, submission.invoiceId);
    if (row === null) throw new AppError('RESOURCE_NOT_FOUND');
    if (row.kind === 'PRIVATE_RENT') throw new AppError('RESOURCE_NOT_FOUND');
    return;
  }
  const visible = await isInvoiceMemberVisible(conn, {
    invoiceId: submission.invoiceId,
    userId: actor.userId,
    at,
  });
  if (!visible) throw new AppError('RESOURCE_NOT_FOUND');
}

async function replayReview(
  conn: Db,
  actor: Actor,
  idempotencyKey: string,
  requestHash: string,
  at: Date,
): Promise<ReviewSubmissionDto> {
  const existing = await getPaymentReviewIdempotencyRecord(conn, {
    scope: 'PAYMENT_REVIEW',
    key: idempotencyKey,
  });
  if (existing === null) throw new AppError('RATE_LIMITED');
  if (existing.requestHash !== requestHash) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The Idempotency-Key was already used with a different request.',
    );
  }
  if (existing.resultRefId === null) throw new AppError('RATE_LIMITED');
  const submission = await findSubmissionById(conn, existing.resultRefId);
  if (submission === null) throw new AppError('RATE_LIMITED');
  await assertReviewerVisible(conn, actor, submission, at);
  if (submission.state !== 'APPROVED' && submission.state !== 'REJECTED') {
    throw new AppError('RATE_LIMITED');
  }
  const row = await findInvoiceById(conn, submission.invoiceId);
  if (row === null) throw new AppError('RESOURCE_NOT_FOUND');
  await assertReviewerVisible(conn, actor, submission, at);
  const balance = await conn.transaction((tx) => readInvoiceBalance(tx, row.id));
  return toReviewDto({
    submission,
    invoiceTotal: row.total,
    approvedTotal: balance.approvedTotal,
    snapshotTimezone: row.snapshotTimezone,
    dueDate: row.dueDate,
    now: at,
    pendingCount: balance.pendingCount,
  });
}

export async function approvePaymentSubmission(
  actor: Actor,
  submissionId: string,
  input: ApproveSubmissionInput,
  ctx: BillingCtx,
  conn: Db = db,
): Promise<ReviewSubmissionDto> {
  assertActive(actor);
  const now = ctx.clock.now();
  const amountSatang = moneyWireBodyToSatang(input.amount);
  const submission = await findSubmissionById(conn, submissionId);
  if (submission === null) throw new AppError('RESOURCE_NOT_FOUND');
  await assertReviewerVisible(conn, actor, submission, now);
  const requestHash = hashRequestBody({
    submissionId,
    action: 'approve',
    amount: input.amount,
  });
  if (input.idempotencyKey !== undefined) {
    const existing = await getPaymentReviewIdempotencyRecord(conn, {
      scope: 'PAYMENT_REVIEW',
      key: input.idempotencyKey,
    });
    if (existing !== null) {
      return replayReview(conn, actor, input.idempotencyKey, requestHash, now);
    }
  }
  return conn.transaction(async (tx) => {
    const lockedSubmission = await lockSubmissionForUpdate(tx, submissionId);
    if (lockedSubmission === null) throw new AppError('RESOURCE_NOT_FOUND');
    assertReviewTransition(lockedSubmission.state);
    const locked = await lockInvoiceForUpdate(tx, lockedSubmission.invoiceId);
    if (locked === null) throw new AppError('RESOURCE_NOT_FOUND');
    const balance = await readInvoiceBalance(tx, locked.id);
    const paidBefore = deriveInvoiceState(locked.total, balance.approvedTotal) === 'PAID';
    if (actor.isSystemAdmin) {
      if (locked.kind === 'PRIVATE_RENT') throw new AppError('RESOURCE_NOT_FOUND');
      const verdict = evaluateInvoiceAccess(
        {
          kind: locked.kind,
          actorIsSystemAdmin: true,
          actorSuspended: false,
          actorMustChangePassword: false,
          inRentReviewerSnapshot: false,
          inFeeResponsibleSnapshot: false,
          tenantOverlap: false,
          activeResidentOfRoom: false,
          currentOwnerOfRoom: false,
          invoicePaid: paidBefore,
          pendingOnInvoice: balance.pendingCount > 0,
        },
        'REVIEW_APPROVE',
      );
      if (!verdict.allowed) {
        if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
        throw new AppError('RESOURCE_NOT_FOUND');
      }
    } else {
      const [rentReviewer, feeResponsible, tenantOverlap] = await Promise.all([
        locked.kind === 'PRIVATE_RENT'
          ? isRentReviewer(tx, { invoiceId: locked.id, userId: actor.userId })
          : Promise.resolve(false),
        locked.kind === 'COMMON_FEE'
          ? isFeeResponsibleOwner(tx, { invoiceId: locked.id, userId: actor.userId })
          : Promise.resolve(false),
        locked.tenancyId === null
          ? Promise.resolve(false)
          : tenantOverlapsInvoice(tx, {
              userId: actor.userId,
              tenancyId: locked.tenancyId,
              serviceStart: locked.serviceStart,
              serviceEndExclusive: locked.serviceEndExclusive,
            }),
      ]);
      const windows =
        locked.kind === 'COMMON_FEE' ? await listMembershipWindowsByUser(actor.userId) : [];
      const verdict = evaluateInvoiceAccess(
        {
          kind: locked.kind,
          actorIsSystemAdmin: false,
          actorSuspended: false,
          actorMustChangePassword: false,
          inRentReviewerSnapshot: rentReviewer,
          inFeeResponsibleSnapshot: feeResponsible,
          tenantOverlap,
          activeResidentOfRoom:
            locked.kind === 'COMMON_FEE'
              ? windows.some(
                  (window) =>
                    window.roomId === locked.roomId &&
                    window.start.getTime() <= now.getTime() &&
                    (window.end === null || window.end.getTime() > now.getTime()),
                )
              : false,
          currentOwnerOfRoom: false,
          invoicePaid: paidBefore,
          pendingOnInvoice: balance.pendingCount > 0,
        },
        'REVIEW_APPROVE',
      );
      if (!verdict.allowed) {
        if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
        throw new AppError('RESOURCE_NOT_FOUND');
      }
    }
    const outstanding = outstandingSatang(locked.total, balance.approvedTotal);
    assertApprovable({ amountSatang, outstandingSatang: outstanding });
    const approved = await approvePendingSubmission(tx, {
      id: lockedSubmission.id,
      approvedAmount: amountSatang,
      reviewedBy: actor.userId,
      reviewedAt: now,
    });
    if (approved === null) throw new AppError('PAYMENT_ALREADY_REVIEWED');
    const afterBalance = await readInvoiceBalance(tx, locked.id);
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'payment_submission.approved',
      resourceType: 'payment_submission',
      resourceId: lockedSubmission.id,
      requestId: ctx.requestId,
      before: { state: 'PENDING', invoiceId: locked.id },
      after: {
        state: 'APPROVED',
        approvedAmount: amountSatang.toString(),
        reviewerId: actor.userId,
      },
      at: now,
    });
    if (input.idempotencyKey !== undefined) {
      await upsertPaymentReviewIdempotencyRecord(tx, {
        scope: 'PAYMENT_REVIEW',
        key: input.idempotencyKey,
        actorId: actor.userId,
        requestHash,
        resultRefType: 'payment_submission',
        resultRefId: lockedSubmission.id,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
    }
    return toReviewDto({
      submission: approved,
      invoiceTotal: locked.total,
      approvedTotal: afterBalance.approvedTotal,
      snapshotTimezone: locked.snapshotTimezone,
      dueDate: locked.dueDate,
      now,
      pendingCount: afterBalance.pendingCount,
    });
  });
}

export async function rejectPaymentSubmission(
  actor: Actor,
  submissionId: string,
  input: RejectSubmissionInput,
  ctx: BillingCtx,
  conn: Db = db,
): Promise<ReviewSubmissionDto> {
  assertActive(actor);
  const now = ctx.clock.now();
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The reject reason is required.');
  }
  const submission = await findSubmissionById(conn, submissionId);
  if (submission === null) throw new AppError('RESOURCE_NOT_FOUND');
  await assertReviewerVisible(conn, actor, submission, now);
  const requestHash = hashRequestBody({ submissionId, action: 'reject', reason });
  if (input.idempotencyKey !== undefined) {
    const existing = await getPaymentReviewIdempotencyRecord(conn, {
      scope: 'PAYMENT_REVIEW',
      key: input.idempotencyKey,
    });
    if (existing !== null) {
      return replayReview(conn, actor, input.idempotencyKey, requestHash, now);
    }
  }
  return conn.transaction(async (tx) => {
    const lockedSubmission = await lockSubmissionForUpdate(tx, submissionId);
    if (lockedSubmission === null) throw new AppError('RESOURCE_NOT_FOUND');
    assertReviewTransition(lockedSubmission.state);
    const locked = await lockInvoiceForUpdate(tx, lockedSubmission.invoiceId);
    if (locked === null) throw new AppError('RESOURCE_NOT_FOUND');
    const balance = await readInvoiceBalance(tx, locked.id);
    const paidBefore = deriveInvoiceState(locked.total, balance.approvedTotal) === 'PAID';
    if (actor.isSystemAdmin) {
      if (locked.kind === 'PRIVATE_RENT') throw new AppError('RESOURCE_NOT_FOUND');
      const verdict = evaluateInvoiceAccess(
        {
          kind: locked.kind,
          actorIsSystemAdmin: true,
          actorSuspended: false,
          actorMustChangePassword: false,
          inRentReviewerSnapshot: false,
          inFeeResponsibleSnapshot: false,
          tenantOverlap: false,
          activeResidentOfRoom: false,
          currentOwnerOfRoom: false,
          invoicePaid: paidBefore,
          pendingOnInvoice: balance.pendingCount > 0,
        },
        'REVIEW_REJECT',
      );
      if (!verdict.allowed) {
        if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
        throw new AppError('RESOURCE_NOT_FOUND');
      }
    } else {
      const [rentReviewer, feeResponsible, tenantOverlap] = await Promise.all([
        locked.kind === 'PRIVATE_RENT'
          ? isRentReviewer(tx, { invoiceId: locked.id, userId: actor.userId })
          : Promise.resolve(false),
        locked.kind === 'COMMON_FEE'
          ? isFeeResponsibleOwner(tx, { invoiceId: locked.id, userId: actor.userId })
          : Promise.resolve(false),
        locked.tenancyId === null
          ? Promise.resolve(false)
          : tenantOverlapsInvoice(tx, {
              userId: actor.userId,
              tenancyId: locked.tenancyId,
              serviceStart: locked.serviceStart,
              serviceEndExclusive: locked.serviceEndExclusive,
            }),
      ]);
      const windows =
        locked.kind === 'COMMON_FEE' ? await listMembershipWindowsByUser(actor.userId) : [];
      const verdict = evaluateInvoiceAccess(
        {
          kind: locked.kind,
          actorIsSystemAdmin: false,
          actorSuspended: false,
          actorMustChangePassword: false,
          inRentReviewerSnapshot: rentReviewer,
          inFeeResponsibleSnapshot: feeResponsible,
          tenantOverlap,
          activeResidentOfRoom:
            locked.kind === 'COMMON_FEE'
              ? windows.some(
                  (window) =>
                    window.roomId === locked.roomId &&
                    window.start.getTime() <= now.getTime() &&
                    (window.end === null || window.end.getTime() > now.getTime()),
                )
              : false,
          currentOwnerOfRoom: false,
          invoicePaid: paidBefore,
          pendingOnInvoice: balance.pendingCount > 0,
        },
        'REVIEW_REJECT',
      );
      if (!verdict.allowed) {
        if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
        throw new AppError('RESOURCE_NOT_FOUND');
      }
    }
    const rejected = await rejectPendingSubmission(tx, {
      id: lockedSubmission.id,
      reviewedBy: actor.userId,
      reviewedAt: now,
      rejectReason: reason,
    });
    if (rejected === null) throw new AppError('PAYMENT_ALREADY_REVIEWED');
    const afterBalance = await readInvoiceBalance(tx, locked.id);
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'payment_submission.rejected',
      resourceType: 'payment_submission',
      resourceId: lockedSubmission.id,
      requestId: ctx.requestId,
      before: { state: 'PENDING', invoiceId: locked.id },
      after: { state: 'REJECTED', reason, reviewerId: actor.userId },
      at: now,
    });
    if (input.idempotencyKey !== undefined) {
      await upsertPaymentReviewIdempotencyRecord(tx, {
        scope: 'PAYMENT_REVIEW',
        key: input.idempotencyKey,
        actorId: actor.userId,
        requestHash,
        resultRefType: 'payment_submission',
        resultRefId: lockedSubmission.id,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
    }
    return toReviewDto({
      submission: rejected,
      invoiceTotal: locked.total,
      approvedTotal: afterBalance.approvedTotal,
      snapshotTimezone: locked.snapshotTimezone,
      dueDate: locked.dueDate,
      now,
      pendingCount: afterBalance.pendingCount,
    });
  });
}
