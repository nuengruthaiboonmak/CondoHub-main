import 'server-only';
import { PROJECT_PAYEE_ID } from '@/config/project';
import { z } from 'zod';
import type { Actor } from '@/shared/auth/actor';
import { requireActiveActor } from '@/shared/auth/guards';
import { db } from '@/shared/db/client';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { getRoomDetail, isOwnerAt } from '@/modules/property-membership/application/index';
import { commitAttachments } from '@/modules/media-attachments/application/index';
import { fillMissingInvoiceInstructions } from '../infrastructure/invoiceRepository';
import { payeeSnapshotToRecord } from '../domain/payeePolicy';
import { canManagePaymentSettings } from '../domain/paymentSettingsPolicy';
import { findPayeeEffectiveAt, insertPayeeInstruction } from '../infrastructure/payeeRepository';
import type { BillingCtx } from './ctx';

export const paymentSettingsBody = z
  .object({
    payeeType: z.enum(['PROJECT', 'OWNER']),
    bankName: z.string().trim().min(1).max(120),
    accountName: z.string().trim().min(1).max(200),
    accountNumber: z.string().trim().min(1).max(80),
    qrImageId: z.string().uuid().nullable(),
    expectedId: z.string().uuid().nullable(),
    applyToUnconfiguredInvoices: z.boolean().default(false),
  })
  .strict();
export type PaymentSettingsInput = z.infer<typeof paymentSettingsBody>;

export async function assertPaymentSettingsAccess(
  actor: Actor,
  roomId: string,
  payeeType: 'PROJECT' | 'OWNER',
  at: Date,
): Promise<void> {
  requireActiveActor(actor);
  if (!z.string().uuid().safeParse(roomId).success) throw new AppError('RESOURCE_NOT_FOUND');
  if (payeeType !== 'OWNER') throw new AppError('RESOURCE_NOT_FOUND');
  await getRoomDetail(roomId);
  const owner =
    !actor.isSystemAdmin && payeeType === 'OWNER'
      ? await isOwnerAt(roomId, actor.userId, at)
      : false;
  if (!canManagePaymentSettings(actor.isSystemAdmin, owner, payeeType))
    throw new AppError('RESOURCE_NOT_FOUND');
}

export async function getRoomPaymentSettings(
  actor: Actor,
  roomId: string,
  payeeType: 'PROJECT' | 'OWNER',
  at: Date,
) {
  await assertPaymentSettingsAccess(actor, roomId, payeeType, at);
  const row = await findPayeeEffectiveAt(db, { payeeType, payeeId: roomId, at });
  return row
    ? {
        id: row.id,
        bankName: row.bankName,
        accountName: row.accountName,
        accountNumber: row.accountNumber,
        qrImageId: row.qrImageId,
      }
    : null;
}

export async function saveRoomPaymentSettings(
  actor: Actor,
  roomId: string,
  input: PaymentSettingsInput,
  ctx: BillingCtx,
) {
  const now = ctx.clock.now();
  await assertPaymentSettingsAccess(actor, roomId, input.payeeType, now);
  return savePaymentSettings(actor, roomId, input, ctx);
}

function assertProjectAccess(actor: Actor) {
  requireActiveActor(actor);
  if (!actor.isSystemAdmin) throw new AppError('RESOURCE_NOT_FOUND');
}

export async function getProjectPaymentSettings(actor: Actor, at: Date) {
  assertProjectAccess(actor);
  const row = await findPayeeEffectiveAt(db, {
    payeeType: 'PROJECT',
    payeeId: PROJECT_PAYEE_ID,
    at,
  });
  return row
    ? {
        id: row.id,
        bankName: row.bankName,
        accountName: row.accountName,
        accountNumber: row.accountNumber,
        qrImageId: row.qrImageId,
      }
    : null;
}

export async function saveProjectPaymentSettings(
  actor: Actor,
  input: PaymentSettingsInput,
  ctx: BillingCtx,
) {
  assertProjectAccess(actor);
  if (input.payeeType !== 'PROJECT') throw new AppError('VALIDATION_ERROR');
  return savePaymentSettings(actor, PROJECT_PAYEE_ID, input, ctx);
}

async function savePaymentSettings(
  actor: Actor,
  payeeId: string,
  input: PaymentSettingsInput,
  ctx: BillingCtx,
) {
  const now = ctx.clock.now();
  try {
    return await db.transaction(
      async (tx) => {
        const previous = await findPayeeEffectiveAt(tx, {
          payeeType: input.payeeType,
          payeeId,
          at: now,
        });
        if ((previous?.id ?? null) !== input.expectedId) throw new AppError('VERSION_CONFLICT');
        const created = await insertPayeeInstruction(tx, {
          ...input,
          payeeId,
          effectiveFrom: now,
        });
        if (input.qrImageId && input.qrImageId !== previous?.qrImageId) {
          await commitAttachments(tx, actor, {
            scope: 'PAYMENT_QR',
            entityRef: { type: 'payment_instruction', id: created.id },
            imageIds: [input.qrImageId],
            maxCount: 1,
            at: now,
          });
        }
        if (input.applyToUnconfiguredInvoices) {
          const updatedIds = await fillMissingInvoiceInstructions(tx, {
            ...(input.payeeType === 'OWNER' ? { roomId: payeeId } : {}),
            payeeType: input.payeeType,
            actorId: actor.userId,
            snapshot: payeeSnapshotToRecord(created),
            at: now,
          });
          for (const id of updatedIds)
            await writeAudit(tx, {
              actorId: actor.userId,
              action: 'invoice.payment_instruction.configured',
              resourceType: 'invoice',
              resourceId: id,
              requestId: ctx.requestId,
              after: { paymentInstructionId: created.id },
            });
        }
        await writeAudit(tx, {
          actorId: actor.userId,
          action: 'payee_instruction.updated',
          resourceType: 'payment_instruction',
          resourceId: created.id,
          requestId: ctx.requestId,
          after: { payeeType: input.payeeType, payeeId },
        });
        return { id: created.id };
      },
      { isolationLevel: 'serializable' },
    );
  } catch (error) {
    throw mapPgError(error, { fallbackCodes: { '40001': 'VERSION_CONFLICT' } });
  }
}
