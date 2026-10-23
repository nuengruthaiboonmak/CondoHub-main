import { z } from 'zod';

export type PublishMode = 'draft' | 'now' | 'scheduled';

export const announcementFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required.').max(255),
    body: z.string().trim().min(1, 'Body is required.').max(20000),
    publishMode: z.enum(['draft', 'now', 'scheduled']),
    publishAt: z.string().optional(),
  })
  .superRefine((values, context) => {
    if (values.publishMode !== 'scheduled') return;
    const timestamp = new Date(values.publishAt ?? '').getTime();
    if (!Number.isFinite(timestamp) || timestamp <= Date.now())
      context.addIssue({
        code: 'custom',
        path: ['publishAt'],
        message: 'Choose a future publish date and time.',
      });
  });

export type AnnouncementFormValues = z.infer<typeof announcementFormSchema>;

export function publishModeFor(value: string | null, now = new Date()): PublishMode {
  if (value === null) return 'draft';
  return new Date(value) > now ? 'scheduled' : 'now';
}

export function publishingTimestamp(
  mode: PublishMode,
  value: string | undefined,
  original: string | null = null,
  now = new Date(),
): string | null {
  if (mode === 'draft') return null;
  if (mode === 'scheduled') return new Date(value ?? '').toISOString();
  return original !== null && new Date(original) <= now ? original : now.toISOString();
}

export function publishTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
