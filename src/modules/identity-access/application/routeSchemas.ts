import { z } from 'zod';
import { parseWithFieldErrors as sharedParseWithFieldErrors } from '@/shared/utils/parseBody';

export const provisionAccountBody = z
  .object({
    username: z.string().min(1).max(30).optional(),
    email: z.string().email().max(255),
    name: z.string().min(1).max(255),
    phone: z.string().max(32).optional(),
    targetRole: z.enum(['TENANT', 'CO_OWNER']).default('TENANT'),
  })
  .strict();

export type ProvisionAccountBody = z.infer<typeof provisionAccountBody>;

export const adminProvisionBody = z
  .object({
    username: z.string().min(1).max(30),
    email: z.string().email().max(255),
    name: z.string().min(1).max(255),
    phone: z.string().max(32).optional(),
    isSystemAdmin: z.boolean().optional(),
  })
  .strict();

export type AdminProvisionBody = z.infer<typeof adminProvisionBody>;

export const accountStatusBody = z
  .object({
    accountStatus: z.enum(['ACTIVE', 'SUSPENDED']),
  })
  .strict();

export type AccountStatusBody = z.infer<typeof accountStatusBody>;

export const userSearchQuery = z.object({
  query: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type UserSearchQuery = z.infer<typeof userSearchQuery>;

export function parseWithFieldErrors<T>(schema: z.ZodType<T>, value: unknown): T {
  return sharedParseWithFieldErrors(schema, value);
}
