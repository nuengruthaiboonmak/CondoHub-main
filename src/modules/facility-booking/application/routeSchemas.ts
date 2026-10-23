import { z } from 'zod';
import { parseWithFieldErrors as sharedParseWithFieldErrors } from '@/shared/utils/parseBody';

export const facilityStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const quotaKindSchema = z.enum(['DAILY', 'WEEKLY', 'MONTHLY']);

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM format.');

const endTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM format.');

const intervalSchema = z
  .object({ start: timeSchema, end: endTimeSchema })
  .strict()
  .superRefine((value, ctx) => {
    const toMinutes = (time: string): number => {
      if (time === '24:00') return 1440;
      const [hour, minute] = time.split(':') as [string, string];
      return Number(hour) * 60 + Number(minute);
    };
    if (toMinutes(value.end) <= toMinutes(value.start)) {
      ctx.addIssue({ code: 'custom', message: 'The interval end must be after its start.' });
    }
  });

const dayScheduleSchema = z
  .object({ open: z.array(intervalSchema).max(8), breaks: z.array(intervalSchema).max(8) })
  .strict();

export const scheduleSchema = z
  .object({
    days: z.object({
      '0': dayScheduleSchema,
      '1': dayScheduleSchema,
      '2': dayScheduleSchema,
      '3': dayScheduleSchema,
      '4': dayScheduleSchema,
      '5': dayScheduleSchema,
      '6': dayScheduleSchema,
    }),
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.')).max(366),
  })
  .strict();

export const facilityCreateBody = z
  .object({
    projectId: z.string().uuid(),
    code: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(20000).nullable().optional(),
    status: facilityStatusSchema.default('ACTIVE'),
    capacity: z.number().int().min(1).max(1000).default(1),
    schedule: scheduleSchema,
    slotMinutes: z.number().int().min(5).max(1440),
    quotaKind: quotaKindSchema,
    quotaLimit: z.number().int().min(0).max(100000),
    advanceDays: z.number().int().min(0).max(365),
  })
  .strict();

export type FacilityCreateBody = z.infer<typeof facilityCreateBody>;

export const facilityPatchBody = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(20000).nullable().optional(),
    status: facilityStatusSchema.optional(),
    capacity: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export type FacilityPatchBody = z.infer<typeof facilityPatchBody>;

export const facilityListQuery = z.object({
  status: facilityStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type FacilityListQuery = z.infer<typeof facilityListQuery>;

export const facilitySlotsQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.'),
  roomId: z.string().uuid(),
});

export type FacilitySlotsQuery = z.infer<typeof facilitySlotsQuery>;

export const bookingCreateBody = z
  .object({
    roomId: z.string().uuid(),
    startsAt: z
      .array(z.string().datetime({ offset: true }))
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.startsAt).size !== value.startsAt.length) {
      ctx.addIssue({ code: 'custom', message: 'The requested slots must be unique.' });
    }
  });

export type BookingCreateBody = z.infer<typeof bookingCreateBody>;

export const slotCancelBody = z
  .object({
    reason: z.string().trim().min(1).max(2000),
    refundQuota: z.boolean().optional(),
  })
  .strict();

export type SlotCancelBody = z.infer<typeof slotCancelBody>;

export const configPreviewBody = z
  .object({
    schedule: scheduleSchema,
    slotMinutes: z.number().int().min(5).max(1440),
    capacity: z.number().int().min(1).max(1000),
    quotaKind: quotaKindSchema,
    quotaLimit: z.number().int().min(0).max(100000),
    advanceDays: z.number().int().min(0).max(365),
    effectiveAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ConfigPreviewBody = z.infer<typeof configPreviewBody>;

export const configCommitBody = configPreviewBody
  .extend({ previewToken: z.string().min(1).max(20000) })
  .strict();

export type ConfigCommitBody = z.infer<typeof configCommitBody>;

export const closureBody = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) {
      ctx.addIssue({ code: 'custom', message: 'The closure end must be after its start.' });
    }
  });

export type ClosureBody = z.infer<typeof closureBody>;

export const roomBookingsQuery = z.object({
  roomId: z.string().uuid(),
  facilityId: z.string().uuid().optional(),
});

export type RoomBookingsQuery = z.infer<typeof roomBookingsQuery>;

export const roomQuotaQuery = z.object({
  roomId: z.string().uuid(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.')
    .optional(),
});

export type RoomQuotaQuery = z.infer<typeof roomQuotaQuery>;

export function parseWithFieldErrors<T>(schema: z.ZodType<T>, value: unknown): T {
  return sharedParseWithFieldErrors(schema, value);
}
