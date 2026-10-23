import { z } from 'zod';
import { parseWithFieldErrors as sharedParseWithFieldErrors } from '@/shared/utils/parseBody';

export const imageIntentBody = z
  .object({
    scope: z.enum(['PAYMENT_SLIP', 'PAYMENT_QR', 'MAINTENANCE', 'ANNOUNCEMENT', 'CHAT']),
    entityRef: z
      .object({
        type: z.string().min(1).max(64),
        id: z.string().uuid().nullable(),
      })
      .strict(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    fileName: z.string().min(1).max(255),
  })
  .strict();

export type ImageIntentBody = z.infer<typeof imageIntentBody>;

export const imageCompleteBody = z.object({}).strict();

export type ImageCompleteBody = z.infer<typeof imageCompleteBody>;

export function parseWithFieldErrors<T>(schema: z.ZodType<T>, value: unknown): T {
  return sharedParseWithFieldErrors(schema, value);
}
