import { z } from 'zod';
import { AppError, type FieldErrors } from './errors';

export function parseWithFieldErrors<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    const list = fieldErrors[key] ?? [];
    list.push(issue.message);
    fieldErrors[key] = list;
  }
  throw new AppError('VALIDATION_ERROR', undefined, { fieldErrors });
}
