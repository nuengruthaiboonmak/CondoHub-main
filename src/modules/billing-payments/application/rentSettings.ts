import 'server-only';
import { z } from 'zod';
import type { Actor } from '@/shared/auth/actor';
import { requireActiveActor } from '@/shared/auth/guards';
import { db } from '@/shared/db/client';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { decimalStringToSatang } from '@/shared/utils/money';
import { formatProjectDate, projectDateParts } from '@/shared/utils/clock';
import { writeAudit } from '@/shared/observability/audit';
import {
  getRoomDetail,
  isOwnerAt,
  listRoomTenancies,
  listRoomMemberships,
  getRentalPeriods,
} from '@/modules/property-membership/application/index';
import { cycleForMonth } from '../domain/billingCycle';
import { canManageRent, selectRentRule } from '../domain/rentRulePolicy';
import {
  listRoomRentRules,
  disableRentRuleAt,
  insertBillingRule,
} from '../infrastructure/billingRepository';
import { findInvoicePayee } from '../infrastructure/payeeRepository';
import { generateInvoicesForCycle } from './generateInvoices';
import { listInvoices } from './invoiceReads';
import type { BillingCtx } from './ctx';

const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const rentSettingsBody = z
  .object({
    tenancyId: z.string().uuid(),
    amount: z
      .object({ amount: z.string().regex(/^(0|[1-9]\d{0,9})\.\d{2}$/), currency: z.literal('THB') })
      .strict(),
    effectiveMonth: month,
    expectedId: z.string().uuid().nullable(),
  })
  .strict();
export const rentInvoiceBody = z.object({ tenancyId: z.string().uuid(), cycle: month }).strict();

async function assertRentManager(actor: Actor, roomId: string, tenancyId: string, at: Date) {
  requireActiveActor(actor);
  if (!z.string().uuid().safeParse(roomId).success) throw new AppError('RESOURCE_NOT_FOUND');
  const room = await getRoomDetail(roomId);
  const tenancy = (await listRoomTenancies(roomId)).find(
    (row) => row.id === tenancyId && row.state === 'ACTIVE',
  );
  if (!tenancy) throw new AppError('RESOURCE_NOT_FOUND');
  const owner = !actor.isSystemAdmin && (await isOwnerAt(roomId, actor.userId, at));
  if (!canManageRent(actor.isSystemAdmin, owner, tenancy.managementMode))
    throw new AppError('RESOURCE_NOT_FOUND');
  const kind =
    tenancy.managementMode === 'PROJECT_MANAGED'
      ? ('PROJECT_MANAGED_RENT' as const)
      : ('PRIVATE_RENT' as const);
  return { room, tenancy, kind };
}

export async function getRentSettings(actor: Actor, roomId: string, tenancyId: string, at: Date) {
  const { kind } = await assertRentManager(actor, roomId, tenancyId, at);
  const rows = await listRoomRentRules(db, roomId, kind);
  const latest = rows[0];
  return latest
    ? {
        id: latest.id,
        amount: latest.rate ?? '0.00',
        effectiveMonth: formatProjectDate(projectDateParts(latest.effectiveAt)).slice(0, 7),
      }
    : null;
}

export async function saveRentSettings(
  actor: Actor,
  roomId: string,
  input: z.infer<typeof rentSettingsBody>,
  ctx: BillingCtx,
) {
  const now = ctx.clock.now();
  const { kind } = await assertRentManager(actor, roomId, input.tenancyId, now);
  if (decimalStringToSatang(input.amount.amount) <= 0n)
    throw new AppError('VALIDATION_ERROR', 'Monthly rent must be greater than zero.');
  const currentMonth = formatProjectDate(projectDateParts(now)).slice(0, 7);
  if (input.effectiveMonth < currentMonth)
    throw new AppError(
      'VALIDATION_ERROR',
      'Choose this month or a future month. Existing invoices keep their issued amounts.',
    );
  const effectiveAt = new Date(`${input.effectiveMonth}-01T00:00:00+07:00`);
  try {
    return await db.transaction(
      async (tx) => {
        const rows = await listRoomRentRules(tx, roomId, kind);
        if ((rows[0]?.id ?? null) !== input.expectedId) throw new AppError('VERSION_CONFLICT');
        await disableRentRuleAt(tx, roomId, kind, effectiveAt);
        const created = await insertBillingRule(tx, {
          roomId,
          kind,
          configMode: 'PER_ROOM',
          rate: input.amount.amount,
          frequency: 'MONTHLY',
          effectiveAt,
          enabled: true,
        });
        await writeAudit(tx, {
          actorId: actor.userId,
          action: 'rent_settings.updated',
          resourceType: 'billing_rule',
          resourceId: created.id,
          requestId: ctx.requestId,
          after: {
            roomId,
            kind,
            effectiveMonth: input.effectiveMonth,
            amount: input.amount.amount,
          },
        });
        return { id: created.id };
      },
      { isolationLevel: 'serializable' },
    );
  } catch (error) {
    throw mapPgError(error, { fallbackCodes: { '40001': 'VERSION_CONFLICT' } });
  }
}

export async function issueRoomRentInvoice(
  actor: Actor,
  roomId: string,
  input: z.infer<typeof rentInvoiceBody>,
  ctx: BillingCtx,
) {
  const now = ctx.clock.now();
  const { room, tenancy, kind } = await assertRentManager(actor, roomId, input.tenancyId, now);
  if (room.status !== 'ACTIVE')
    throw new AppError('VALIDATION_ERROR', 'Activate the room before issuing rent.');
  const start = new Date(`${input.cycle}-01T00:00:00+07:00`);
  const currentMonth = formatProjectDate(projectDateParts(now)).slice(0, 7);
  if (input.cycle < currentMonth)
    throw new AppError('VALIDATION_ERROR', 'Choose this month or a future month.');
  const periods = await getRentalPeriods(roomId, input.cycle);
  if (
    !periods.some((row) => row.id === tenancy.id) ||
    periods.some((row) => row.managementMode !== tenancy.managementMode)
  )
    throw new AppError(
      'VALIDATION_ERROR',
      'This month needs a turnover review. Open Turnover reviews to resolve its rental periods.',
    );
  const rules = await listRoomRentRules(db, roomId, kind);
  if (!selectRentRule(rules, roomId, kind, start))
    throw new AppError(
      'VALIDATION_ERROR',
      'Set monthly rent effective on or before this billing month first.',
    );
  const memberships = await listRoomMemberships(roomId);
  const [year, cycleMonth] = input.cycle.split('-').map(Number);
  const cycleWindow = cycleForMonth('MONTHLY', year!, cycleMonth!);
  if (
    !memberships.some(
      (row) =>
        row.tenancyId === tenancy.id &&
        row.startAt < cycleWindow.cycleEndExclusive &&
        (!row.endAt || row.endAt > cycleWindow.cycleStart),
    )
  )
    throw new AppError(
      'VALIDATION_ERROR',
      'Add a tenant to this rental period before creating an invoice.',
    );
  if (
    !(await findInvoicePayee(db, {
      payeeType: kind === 'PRIVATE_RENT' ? 'OWNER' : 'PROJECT',
      roomId,
      at: now,
    }))
  )
    throw new AppError(
      'VALIDATION_ERROR',
      'Configure the receiving account before creating an invoice.',
    );
  const counts = await generateInvoicesForCycle(actor, input.cycle, ctx, { rooms: [room], rules });
  if (counts.cycleErrors.length)
    throw new AppError(
      'VALIDATION_ERROR',
      counts.cycleErrors[0]?.reason ?? 'The rent invoice could not be created.',
    );
  const invoices = await listInvoices(actor, { roomId, kind, page: 1, pageSize: 100, at: now });
  const issued = invoices.rows.find(
    (row) => row.periodStart === `${input.cycle}-01` && row.tenancyId === tenancy.id,
  );
  return { invoiceId: issued?.id ?? null, reviewRequired: !issued };
}
