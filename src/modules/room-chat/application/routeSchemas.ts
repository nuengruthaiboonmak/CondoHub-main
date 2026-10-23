import 'server-only';
import { z } from 'zod';
import { parseWithFieldErrors as sharedParseWithFieldErrors } from '@/shared/utils/parseBody';
import { CHAT_DEFAULT_LIMIT, CHAT_MAX_LIMIT } from '@/shared/utils/pagination';
import { CHAT_TEXT_MAX_LENGTH } from '../domain/messageSend';

export const chatListQuery = z
  .object({
    before: z.string().min(1).optional(),
    after: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(CHAT_MAX_LIMIT).default(CHAT_DEFAULT_LIMIT),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.before !== undefined && value.after !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['before'],
        message: 'Only one of before or after may be provided.',
      });
    }
  });

export type ChatListQuery = z.infer<typeof chatListQuery>;

export const chatSendBody = z
  .object({
    clientMessageId: z.string().uuid(),
    text: z.string().trim().max(CHAT_TEXT_MAX_LENGTH).optional(),
    imageId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const text = value.text === undefined ? null : value.text.trim();
    const imageId = value.imageId === undefined ? null : value.imageId;
    const hasText = text !== null && text.length > 0;
    const hasImage = imageId !== null;
    if (!hasText && !hasImage) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'The message must include text or an image.',
      });
    }
  });

export type ChatSendBody = z.infer<typeof chatSendBody>;

export function parseWithFieldErrors<T>(schema: z.ZodType<T>, value: unknown): T {
  return sharedParseWithFieldErrors(schema, value);
}
