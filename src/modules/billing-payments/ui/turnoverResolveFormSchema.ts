import { z } from 'zod';

const TENANCY_ID = z.string().uuid('Select a valid tenancy.');

const CALENDAR_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function calendarValidDate(value: string): boolean {
  if (!CALENDAR_DATE_REGEX.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const MONEY_AMOUNT_REGEX = /^(0|[1-9]\d*)\.\d{2}$/;

const dueDateField = z
  .string()
  .trim()
  .min(1, 'Due date is required.')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine(calendarValidDate, 'The due date must be a valid calendar date.');

const perInvoiceEntry = z
  .object({
    tenancyId: TENANCY_ID,
    dueDate: dueDateField,
    confirmPastDueDate: z.boolean().optional(),
    amountOverride: z
      .string()
      .trim()
      .regex(MONEY_AMOUNT_REGEX, 'Use the "3000.00" format with exactly 2 decimals.')
      .optional()
      .or(z.literal('')),
    overrideReason: z.string().trim().max(500).optional().or(z.literal('')),
  })
  .refine(
    (value) => {
      const override = (value.amountOverride ?? '').trim();
      return override === '' || (value.overrideReason ?? '').trim() !== '';
    },
    {
      message: 'The override reason is required when overriding the amount.',
      path: ['overrideReason'],
    },
  );

const issueInvoicesBranch = z
  .object({
    decision: z.literal('ISSUE_INVOICES'),
    selectedTenancyIds: z.array(TENANCY_ID).min(1, 'Select at least one tenancy to bill.'),
    perInvoice: z.array(perInvoiceEntry).min(1, 'Select at least one tenancy to bill.'),
    noChargeReason: z.string().max(500).optional().or(z.literal('')),
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

const noChargeBranch = z.object({
  decision: z.literal('NO_CHARGE'),
  selectedTenancyIds: z.tuple([]),
  perInvoice: z.tuple([]),
  noChargeReason: z.string().trim().min(1, 'The no-charge reason must not be blank.').max(500),
  expectedVersion: z.number().int(),
});

export const turnoverResolveFormSchema = z.discriminatedUnion('decision', [
  issueInvoicesBranch,
  noChargeBranch,
]);

export type TurnoverResolveFormValues = z.infer<typeof turnoverResolveFormSchema>;

export const PER_INVOICE_FIELD_IDS = {
  checkbox: (tenancyId: string) => `turnover-resolve-select-${tenancyId}`,
  dueDate: (tenancyId: string) => `turnover-resolve-due-${tenancyId}`,
  dueDateError: (tenancyId: string) => `turnover-resolve-due-error-${tenancyId}`,
  confirm: (tenancyId: string) => `turnover-resolve-confirm-${tenancyId}`,
  override: (tenancyId: string) => `turnover-resolve-override-${tenancyId}`,
  overrideError: (tenancyId: string) => `turnover-resolve-override-error-${tenancyId}`,
  overrideReason: (tenancyId: string) => `turnover-resolve-override-reason-${tenancyId}`,
  overrideReasonError: (tenancyId: string) => `turnover-resolve-override-reason-error-${tenancyId}`,
} as const;
