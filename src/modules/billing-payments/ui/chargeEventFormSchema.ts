import { z } from 'zod';

const calendarDate = z
  .string()
  .trim()
  .min(1, 'Effective date is required.')
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Use the YYYY-MM-DD format.');

const moneyAmount = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)\.\d{2}$/, 'Use the "3000.00" format with exactly 2 decimals.');

export const chargeEventCreateSchema = z.object({
  eventEffectiveDate: calendarDate,
  configuredAmount: z.union([moneyAmount, z.literal('')]).optional(),
  contextNote: z.string().trim().max(500).optional(),
});

export type ChargeEventCreateValues = z.infer<typeof chargeEventCreateSchema>;
