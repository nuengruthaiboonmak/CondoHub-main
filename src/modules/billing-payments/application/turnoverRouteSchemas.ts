import 'server-only';
import { z } from 'zod';
import { moneyWireSchema } from '@/shared/utils/moneySchema';
import { isCalendarValidDate } from '../domain/turnoverResolve';

const issueInvoicesDecision = z
  .object({
    decision: z.literal('ISSUE_INVOICES'),
    selectedTenancyIds: z.array(z.string().uuid()).min(1),
    perInvoice: z
      .array(
        z.object({
          tenancyId: z.string().uuid(),
          dueDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine(isCalendarValidDate),
          confirmPastDueDate: z.boolean().optional(),
          amountOverride: moneyWireSchema.optional(),
          overrideReason: z.string().trim().min(1).optional(),
        }),
      )
      .min(1),
    expectedVersion: z.number().int(),
  })
  .refine(
    (value) =>
      new Set(value.perInvoice.map((entry) => entry.tenancyId)).size ===
        value.perInvoice.length &&
      new Set(value.selectedTenancyIds).size === value.selectedTenancyIds.length &&
      value.perInvoice.length === value.selectedTenancyIds.length &&
      value.perInvoice.every((entry) => value.selectedTenancyIds.includes(entry.tenancyId)),
    'set(perInvoice[].tenancyId) must equal set(selectedTenancyIds) exactly',
  );

const noChargeDecision = z.object({
  decision: z.literal('NO_CHARGE'),
  selectedTenancyIds: z.tuple([]),
  reason: z.string().trim().min(1),
  expectedVersion: z.number().int(),
});

export const resolveTurnoverBody = z.discriminatedUnion('decision', [
  issueInvoicesDecision,
  noChargeDecision,
]);

export type ResolveTurnoverBody = z.infer<typeof resolveTurnoverBody>;

export const turnoverReviewListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  state: z.enum(['UNRESOLVED', 'RESOLVED', 'NO_CHARGE']).optional(),
});

export type TurnoverReviewListQuery = z.infer<typeof turnoverReviewListQuery>;
