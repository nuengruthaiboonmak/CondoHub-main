import { z } from 'zod';

export const CHAT_COMPOSER_TEXT_MAX = 20000;

export const chatComposerFormSchema = z
  .object({
    text: z.string().max(CHAT_COMPOSER_TEXT_MAX, 'The message is too long.'),
  })
  .strict();

export type ChatComposerFormValues = z.infer<typeof chatComposerFormSchema>;
