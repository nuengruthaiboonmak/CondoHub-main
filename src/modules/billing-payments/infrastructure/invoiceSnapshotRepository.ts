import 'server-only';
import { eq } from 'drizzle-orm';
import type { Db } from '@/shared/db/transaction';
import {
  commonFeeInvoiceResponsibleOwner,
  privateRentInvoiceReviewer,
} from './schema';

export interface InvoiceSnapshotMember {
  userId: string;
  ownershipIntervalRef: string | null;
}

export async function listRentInvoiceReviewers(
  conn: Db,
  invoiceId: string,
): Promise<InvoiceSnapshotMember[]> {
  const rows = await conn
    .select()
    .from(privateRentInvoiceReviewer)
    .where(eq(privateRentInvoiceReviewer.invoiceId, invoiceId));
  return rows.map((row) => ({
    userId: row.userId,
    ownershipIntervalRef: row.ownershipIntervalRef,
  }));
}

export async function listFeeInvoiceResponsibleOwners(
  conn: Db,
  invoiceId: string,
): Promise<InvoiceSnapshotMember[]> {
  const rows = await conn
    .select()
    .from(commonFeeInvoiceResponsibleOwner)
    .where(eq(commonFeeInvoiceResponsibleOwner.invoiceId, invoiceId));
  return rows.map((row) => ({
    userId: row.userId,
    ownershipIntervalRef: row.ownershipIntervalRef,
  }));
}
