import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { satangToDecimalString } from '@/shared/utils/money';
import type { MoneyWireBody } from '@/shared/utils/moneySchema';
import { moneyWireBodyToSatang } from '@/shared/utils/moneySchema';
import { formatProjectDate, projectDateParts } from '@/shared/utils/clock';
import { writeAudit } from '@/shared/observability/audit';
import { evaluateInvoiceAccess } from '../domain/invoicePolicy';
import {
  assertEditableTotal,
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
  updateInvoiceTotal,
  type InvoiceRecord,
} from '../infrastructure/invoiceRepository';
import { insertInvoiceRevision } from '../infrastructure/paymentSubmissionRepository';
import { listMembershipWindowsByUser } from '@/modules/property-membership/application/index';
import type { BillingCtx } from './ctx';

export interface EditInvoiceInput {
  total: MoneyWireBody;
  expectedVersion: number;
  reason?: string | undefined;
}

export interface EditInvoiceDto {
  id: string;
  version: number;
  total: { amount: string; currency: 'THB' };
  approvedTotal: { amount: string; currency: 'THB' };
  outstanding: { amount: string; currency: 'THB' };
  state: DerivedInvoiceState;
  overdue: boolean;
  pendingOnPaid: boolean;
  reason: string | null;
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

export async function editInvoiceTotal(
  actor: Actor,
  invoiceId: string,
  input: EditInvoiceInput,
  ctx: BillingCtx,
  conn: Db = db,
): Promise<EditInvoiceDto> {
  assertActive(actor);
  const now = ctx.clock.now();
  const newTotalSatang = moneyWireBodyToSatang(input.total);
  const row = await findInvoiceById(conn, invoiceId);
  if (row === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (actor.isSystemAdmin && row.kind === 'PRIVATE_RENT') {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  if (!actor.isSystemAdmin) {
    const visible = await isInvoiceMemberVisible(conn, {
      invoiceId: row.id,
      userId: actor.userId,
      at: now,
    });
    if (!visible) throw new AppError('RESOURCE_NOT_FOUND');
  }
  return conn.transaction(async (tx) => {
    const locked: InvoiceRecord | null = await lockInvoiceForUpdate(tx, invoiceId);
    if (locked === null) throw new AppError('RESOURCE_NOT_FOUND');
    if (locked.version !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');
    const balance = await readInvoiceBalance(tx, locked.id);
    const paidBefore = deriveInvoiceState(locked.total, balance.approvedTotal) === 'PAID';
    if (actor.isSystemAdmin) {
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
        'EDIT',
      );
      if (!verdict.allowed) {
        if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
        throw new AppError('RESOURCE_NOT_FOUND');
      }
    } else {
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
        'EDIT',
      );
      if (!verdict.allowed) {
        if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
        throw new AppError('RESOURCE_NOT_FOUND');
      }
    }
    assertEditableTotal({
      invoicePaid: paidBefore,
      approvedTotalSatang: balance.approvedTotal,
      newTotalSatang,
    });
    const updated = await updateInvoiceTotal(tx, {
      id: locked.id,
      fromVersion: locked.version,
      newTotal: newTotalSatang,
    });
    if (updated === null) throw new AppError('VERSION_CONFLICT');
    await insertInvoiceRevision(tx, {
      invoiceId: locked.id,
      oldTotal: locked.total,
      newTotal: newTotalSatang,
      reason: input.reason ?? null,
      actorId: actor.userId,
      changedAt: now,
    });
    const state = deriveInvoiceState(newTotalSatang, balance.approvedTotal);
    const outstanding = outstandingSatang(newTotalSatang, balance.approvedTotal);
    const today = formatProjectDate(projectDateParts(now, locked.snapshotTimezone));
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'invoice.total.edited',
      resourceType: 'invoice',
      resourceId: locked.id,
      requestId: ctx.requestId,
      before: { total: locked.total.toString(), version: locked.version },
      after: {
        total: newTotalSatang.toString(),
        version: updated.version,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      },
      at: now,
    });
    return {
      id: locked.id,
      version: updated.version,
      total: { amount: satangToDecimalString(newTotalSatang), currency: 'THB' },
      approvedTotal: { amount: satangToDecimalString(balance.approvedTotal), currency: 'THB' },
      outstanding: { amount: satangToDecimalString(outstanding), currency: 'THB' },
      state,
      overdue: isOverdue({
        projectToday: today,
        dueDate: locked.dueDate,
        outstandingSatang: outstanding,
      }),
      pendingOnPaid: state === 'PAID' && balance.pendingCount > 0,
      reason: input.reason ?? null,
    };
  });
}
