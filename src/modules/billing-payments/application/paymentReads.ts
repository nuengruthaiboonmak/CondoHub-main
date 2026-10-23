import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { satangToDecimalString } from '@/shared/utils/money';
import { findInvoiceById, isInvoiceMemberVisible, readPayeeSnapshot } from '../infrastructure/invoiceRepository';
import {
  listRevisionsForInvoice,
  listSubmissionsForInvoice,
  type InvoiceRevisionRecord,
  type PaymentSubmissionRecord,
} from '../infrastructure/paymentSubmissionRepository';
import type { PaymentSubmissionState } from '../infrastructure/schema';

export interface PaymentSubmissionDto {
  id: string;
  invoiceId: string;
  state: PaymentSubmissionState;
  submittedBy: string;
  imageId: string;
  approvedAmount: { amount: string; currency: 'THB' } | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}

export interface InvoiceRevisionDto {
  id: string;
  invoiceId: string;
  oldTotal: { amount: string; currency: 'THB' };
  newTotal: { amount: string; currency: 'THB' };
  reason: string | null;
  actorId: string | null;
  changedAt: string;
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

function toSubmissionDto(row: PaymentSubmissionRecord): PaymentSubmissionDto {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    state: row.state,
    submittedBy: row.submittedBy,
    imageId: row.imageId,
    approvedAmount:
      row.approvedAmount === null
        ? null
        : { amount: satangToDecimalString(row.approvedAmount), currency: 'THB' },
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString(),
    rejectReason: row.rejectReason,
  };
}

function toRevisionDto(row: InvoiceRevisionRecord): InvoiceRevisionDto {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    oldTotal: { amount: satangToDecimalString(row.oldTotal), currency: 'THB' },
    newTotal: { amount: satangToDecimalString(row.newTotal), currency: 'THB' },
    reason: row.reason,
    actorId: row.actorId,
    changedAt: row.changedAt.toISOString(),
  };
}

async function assertPaymentHistoryVisible(
  actor: Actor,
  invoiceId: string,
  at: Date,
  conn: Db,
): Promise<void> {
  const row = await findInvoiceById(conn, invoiceId);
  if (row === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (actor.isSystemAdmin) {
    if (row.kind === 'PRIVATE_RENT') throw new AppError('RESOURCE_NOT_FOUND');
    return;
  }
  const visible = await isInvoiceMemberVisible(conn, {
    invoiceId: row.id,
    userId: actor.userId,
    at,
  });
  if (!visible) throw new AppError('RESOURCE_NOT_FOUND');
}

export async function listPaymentSubmissions(
  actor: Actor,
  invoiceId: string,
  at: Date,
  conn: Db = db,
): Promise<PaymentSubmissionDto[]> {
  assertActive(actor);
  await assertPaymentHistoryVisible(actor, invoiceId, at, conn);
  const rows = await listSubmissionsForInvoice(conn, invoiceId);
  return rows.map(toSubmissionDto);
}

export async function listInvoiceRevisions(
  actor: Actor,
  invoiceId: string,
  at: Date,
  conn: Db = db,
): Promise<InvoiceRevisionDto[]> {
  assertActive(actor);
  await assertPaymentHistoryVisible(actor, invoiceId, at, conn);
  const rows = await listRevisionsForInvoice(conn, invoiceId);
  return rows.map(toRevisionDto);
}

export interface PaymentInstructionDto {
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageId: string | null;
}

function parsePayeeSnapshot(value: unknown): PaymentInstructionDto | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.bankName !== 'string' ||
    typeof record.accountName !== 'string' ||
    typeof record.accountNumber !== 'string'
  ) {
    return null;
  }
  return {
    bankName: record.bankName,
    accountName: record.accountName,
    accountNumber: record.accountNumber,
    qrImageId: typeof record.qrImageId === 'string' ? record.qrImageId : null,
  };
}

export async function getPaymentInstruction(
  actor: Actor,
  invoiceId: string,
  at: Date,
  conn: Db = db,
): Promise<PaymentInstructionDto | null> {
  assertActive(actor);
  const row = await findInvoiceById(conn, invoiceId);
  if (row === null) return null;
  if (actor.isSystemAdmin && row.kind === 'PRIVATE_RENT') return null;
  if (!actor.isSystemAdmin) {
    const visible = await isInvoiceMemberVisible(conn, {
      invoiceId: row.id,
      userId: actor.userId,
      at,
    });
    if (!visible) return null;
  }
  return parsePayeeSnapshot(await readPayeeSnapshot(conn, row.id));
}
