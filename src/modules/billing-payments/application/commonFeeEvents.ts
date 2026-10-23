import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { PROJECT_TIMEZONE } from '@/config/project';
import { writeAudit } from '@/shared/observability/audit';
import { moneyWireBodyToSatang, type MoneyWireBody } from '@/shared/utils/moneySchema';
import { satangToDecimalString } from '@/shared/utils/money';
import {
  findChargeEventById,
  insertChargeEvent,
  listChargeEvents,
} from '../infrastructure/billingRepository';
import { parseCalendarDate } from '../domain/billingWindow';
import type { BillingCtx } from './ctx';

export interface CreateChargeEventInput {
  sourceRuleId?: string | null | undefined;
  eventEffectiveDate: string;
  configuredAmount?: MoneyWireBody | null | undefined;
  chargeContext?: Record<string, unknown> | null | undefined;
  status?: 'OPEN' | 'ISSUED' | 'CANCELLED' | undefined;
}

export interface ChargeEventDto {
  id: string;
  sourceRuleId: string | null;
  eventEffectiveDate: string;
  projectTimezone: string | null;
  configuredAmount: { amount: string; currency: 'THB' } | null;
  chargeContext: unknown;
  createdBy: string | null;
  createdAt: string;
  status: 'OPEN' | 'ISSUED' | 'CANCELLED';
}

function toDto(row: {
  id: string;
  sourceRuleId: string | null;
  eventEffectiveDate: string;
  projectTimezone: string | null;
  configuredAmount: bigint | null;
  chargeContext: unknown;
  createdBy: string | null;
  createdAt: Date;
  status: 'OPEN' | 'ISSUED' | 'CANCELLED';
}): ChargeEventDto {
  return {
    id: row.id,
    sourceRuleId: row.sourceRuleId,
    eventEffectiveDate: row.eventEffectiveDate,
    projectTimezone: row.projectTimezone,
    configuredAmount:
      row.configuredAmount === null
        ? null
        : { amount: satangToDecimalString(row.configuredAmount), currency: 'THB' },
    chargeContext: row.chargeContext,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
  };
}

function assertAdmin(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
}

export async function createCommonFeeEvent(
  actor: Actor,
  input: CreateChargeEventInput,
  ctx: BillingCtx,
  conn: Db = db,
): Promise<ChargeEventDto> {
  assertAdmin(actor);
  parseCalendarDate(input.eventEffectiveDate);
  const configuredAmount =
    input.configuredAmount === undefined || input.configuredAmount === null
      ? null
      : moneyWireBodyToSatang(input.configuredAmount);
  try {
    const created = await conn.transaction(async (tx) => {
      const row = await insertChargeEvent(tx, {
        eventEffectiveDate: input.eventEffectiveDate,
        status: input.status ?? 'OPEN',
        projectTimezone: PROJECT_TIMEZONE,
        ...(input.sourceRuleId !== undefined ? { sourceRuleId: input.sourceRuleId } : {}),
        ...(configuredAmount !== null ? { configuredAmount } : {}),
        ...(input.chargeContext !== undefined ? { chargeContext: input.chargeContext } : {}),
        createdBy: actor.userId,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'common_fee_event.created',
        resourceType: 'common_fee_charge_event',
        resourceId: row.id,
        requestId: ctx.requestId,
        after: { eventEffectiveDate: row.eventEffectiveDate, status: row.status },
      });
      return row;
    });
    return toDto(created);
  } catch (error) {
    throw mapPgError(error);
  }
}

export async function getCommonFeeEvent(
  actor: Actor,
  id: string,
  conn: Db = db,
): Promise<ChargeEventDto | null> {
  assertAdmin(actor);
  const row = await findChargeEventById(conn, id);
  return row === null ? null : toDto(row);
}

export async function listCommonFeeEvents(
  actor: Actor,
  status: 'OPEN' | 'ISSUED' | 'CANCELLED' = 'OPEN',
  conn: Db = db,
): Promise<ChargeEventDto[]> {
  assertAdmin(actor);
  return (await listChargeEvents(conn, status)).map(toDto);
}
