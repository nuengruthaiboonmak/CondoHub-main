import { z } from 'zod';
import { PROJECT_CURRENCY } from '../../config/project';
import { MONEY_STRING_REGEX, decimalStringToSatang } from './money';

export const moneyWireSchema = z
  .object({
    amount: z.string().regex(MONEY_STRING_REGEX),
    currency: z.literal(PROJECT_CURRENCY),
  })
  .strict();

export type MoneyWireBody = z.infer<typeof moneyWireSchema>;

export function moneyWireBodyToSatang(body: MoneyWireBody): bigint {
  return decimalStringToSatang(body.amount);
}
