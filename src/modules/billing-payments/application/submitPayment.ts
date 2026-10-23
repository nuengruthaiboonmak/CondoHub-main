import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { commitAttachments } from '@/modules/media-attachments/application/index';
import { evaluateInvoiceAccess } from '../domain/invoicePolicy';
import { deriveInvoiceState } from '../domain/paymentState';
import {
  findInvoiceById,
  isFeeResponsibleOwner,
  isInvoiceMemberVisible,
  isRentReviewer,
  lockInvoiceForUpdate,
  readInvoiceBalance,
  tenantOverlapsInvoice,
} from '../infrastructure/invoiceRepository';
import { insertPendingSubmission } from '../infrastructure/paymentSubmissionRepository';
import { listMembershipWindowsByUser } from '@/modules/property-membership/application/index';
import type { BillingCtx } from './ctx';

export interface SubmitPaymentInput {
  imageId: string;
}

export interface SubmitPaymentDto {
  id: string;
  invoiceId: string;
  state: 'PENDING';
  submittedBy: string;
  imageId: string;
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

export async function submitPayment(
  actor: Actor,
  invoiceId: string,
  input: SubmitPaymentInput,
  ctx: BillingCtx,
  conn: Db = db,
): Promise<SubmitPaymentDto> {
  assertActive(actor);
  if (actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  const now = ctx.clock.now();
  const row = await findInvoiceById(conn, invoiceId);
  if (row === null) throw new AppError('RESOURCE_NOT_FOUND');
  const visible = await isInvoiceMemberVisible(conn, {
    invoiceId: row.id,
    userId: actor.userId,
    at: now,
  });
  if (!visible) throw new AppError('RESOURCE_NOT_FOUND');
  try {
    return await conn.transaction(async (tx) => {
      const locked = await lockInvoiceForUpdate(tx, invoiceId);
      if (locked === null) throw new AppError('RESOURCE_NOT_FOUND');
      const [rentReviewer, feeResponsible, tenantOverlap, windows] = await Promise.all([
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
        locked.kind === 'COMMON_FEE'
          ? listMembershipWindowsByUser(actor.userId)
          : Promise.resolve([]),
      ]);
      const preBalance = await readInvoiceBalance(tx, locked.id);
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
          invoicePaid: deriveInvoiceState(locked.total, preBalance.approvedTotal) === 'PAID',
          pendingOnInvoice: preBalance.pendingCount > 0,
        },
        'SUBMIT_PAYMENT',
      );
      if (!verdict.allowed) {
        if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
        throw new AppError('RESOURCE_NOT_FOUND');
      }
      const created = await insertPendingSubmission(tx, {
        invoiceId: locked.id,
        submittedBy: actor.userId,
        imageId: input.imageId,
      });
      await commitAttachments(tx, actor, {
        scope: 'PAYMENT_SLIP',
        entityRef: { type: 'payment_submission', id: created.id },
        imageIds: [input.imageId],
        maxCount: 1,
        at: now,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'payment_submission.submitted',
        resourceType: 'payment_submission',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { invoiceId: locked.id },
        at: now,
      });
      return {
        id: created.id,
        invoiceId: locked.id,
        state: 'PENDING',
        submittedBy: created.submittedBy,
        imageId: created.imageId,
      };
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: {
        payment_submission_pending_puq: 'PENDING_PAYMENT_EXISTS',
      },
      fallbackCodes: {
        '23503': 'VALIDATION_ERROR',
      },
    });
  }
}
