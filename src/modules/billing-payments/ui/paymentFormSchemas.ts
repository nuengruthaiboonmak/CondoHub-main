import { z } from 'zod';

const MONEY_AMOUNT_REGEX = /^(0|[1-9]\d*)\.\d{2}$/;

export const paymentApproveFormSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, 'The approved amount is required.')
    .regex(MONEY_AMOUNT_REGEX, 'Use the "3000.00" format with exactly 2 decimals.'),
});

export type PaymentApproveFormValues = z.infer<typeof paymentApproveFormSchema>;

export const paymentRejectFormSchema = z.object({
  reason: z.string().trim().min(1, 'The rejection reason must not be blank.').max(2000),
});

export type PaymentRejectFormValues = z.infer<typeof paymentRejectFormSchema>;

export const invoiceEditFormSchema = z.object({
  total: z
    .string()
    .trim()
    .min(1, 'The new total is required.')
    .regex(MONEY_AMOUNT_REGEX, 'Use the "3000.00" format with exactly 2 decimals.'),
  reason: z.string().trim().max(2000).optional().or(z.literal('')),
  expectedVersion: z.number().int(),
});

export type InvoiceEditFormValues = z.infer<typeof invoiceEditFormSchema>;

export const paymentSubmitFormSchema = z.object({
  imageId: z.string().uuid('Upload a payment slip image first.'),
});

export type PaymentSubmitFormValues = z.infer<typeof paymentSubmitFormSchema>;
