import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { PROJECT_TIMEZONE } from '@/config/project';
import { parseCalendarDate } from '../domain/billingWindow';
import {
  insertBillingRule,
  insertChargeEvent,
  type BillingRuleRecord,
  type ChargeEventRecord,
} from '../infrastructure/billingRepository';
import {
  insertPayeeInstruction,
  type PaymentInstructionRecord,
} from '../infrastructure/payeeRepository';
import type { FeeConfigMode, FeeFrequency, InvoiceKind } from '../infrastructure/schema';
import type { BillingCtx } from './ctx';

function requireSeedAdmin(actor: Actor, ctx: BillingCtx): void {
  if (!ctx.isSeedActor) throw new AppError('ACCESS_DENIED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
}

export interface SeedBillingRuleInput {
  kind: InvoiceKind;
  roomId?: string | null | undefined;
  configMode: FeeConfigMode;
  rate?: string | null | undefined;
  frequency: FeeFrequency;
  effectiveAt: Date;
}

export async function seedBillingRule(
  actor: Actor,
  input: SeedBillingRuleInput,
  ctx: BillingCtx,
): Promise<BillingRuleRecord> {
  requireSeedAdmin(actor, ctx);
  try {
    return await db.transaction(async (tx) => {
      const created = await insertBillingRule(tx, {
        kind: input.kind,
        roomId: input.roomId ?? null,
        configMode: input.configMode,
        rate: input.rate ?? null,
        frequency: input.frequency,
        effectiveAt: input.effectiveAt,
        enabled: true,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'billing_rule.seed.created',
        resourceType: 'billing_rule',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { kind: created.kind, frequency: created.frequency, roomId: created.roomId },
      });
      return created;
    });
  } catch (error) {
    throw mapPgError(error);
  }
}

export interface SeedPayeeInstructionInput {
  payeeType: string;
  payeeId: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageId?: string | null | undefined;
  effectiveFrom: Date;
}

export async function seedPayeeInstruction(
  actor: Actor,
  input: SeedPayeeInstructionInput,
  ctx: BillingCtx,
): Promise<PaymentInstructionRecord> {
  requireSeedAdmin(actor, ctx);
  try {
    return await db.transaction(async (tx) => {
      const created = await insertPayeeInstruction(tx, {
        payeeType: input.payeeType,
        payeeId: input.payeeId,
        bankName: input.bankName,
        accountName: input.accountName,
        accountNumber: input.accountNumber,
        qrImageId: input.qrImageId ?? null,
        effectiveFrom: input.effectiveFrom,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'payee_instruction.seed.created',
        resourceType: 'payment_instruction',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { payeeType: created.payeeType, payeeId: created.payeeId },
      });
      return created;
    });
  } catch (error) {
    throw mapPgError(error);
  }
}

export interface SeedChargeEventInput {
  eventEffectiveDate: string;
  configuredAmountSatang?: bigint | null | undefined;
  chargeContext?: Record<string, unknown> | null | undefined;
  runId: string;
}

export async function seedChargeEvent(
  actor: Actor,
  input: SeedChargeEventInput,
  ctx: BillingCtx,
): Promise<ChargeEventRecord> {
  requireSeedAdmin(actor, ctx);
  parseCalendarDate(input.eventEffectiveDate);
  try {
    return await db.transaction(async (tx) => {
      const created = await insertChargeEvent(tx, {
        eventEffectiveDate: input.eventEffectiveDate,
        status: 'OPEN',
        projectTimezone: PROJECT_TIMEZONE,
        ...(input.configuredAmountSatang !== undefined && input.configuredAmountSatang !== null
          ? { configuredAmount: input.configuredAmountSatang }
          : {}),
        chargeContext: { ...(input.chargeContext ?? {}), runId: input.runId },
        createdBy: actor.userId,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'common_fee_event.seed.created',
        resourceType: 'common_fee_charge_event',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { eventEffectiveDate: created.eventEffectiveDate },
      });
      return created;
    });
  } catch (error) {
    throw mapPgError(error);
  }
}
