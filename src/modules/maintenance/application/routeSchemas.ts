import 'server-only';
import { z } from 'zod';
import { parseWithFieldErrors as sharedParseWithFieldErrors } from '@/shared/utils/parseBody';
import { IMAGE_COUNT_CAPS } from '@/config/imageLimits';

export const maintenanceRoutingKinds = [
  'COMMON_AREA',
  'PRIVATE_OWNER',
  'PROJECT_MANAGED_PRIVATE',
] as const;

export const maintenanceStatuses = [
  'PENDING',
  'IN_PROGRESS',
  'WAITING_FOR_INFO',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;

export const ticketListQuery = z.object({
  view: z.enum(['open', 'history']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  roomId: z.string().uuid().optional(),
  routingKind: z.enum(maintenanceRoutingKinds).optional(),
  status: z.enum(maintenanceStatuses).optional(),
});

export type TicketListQuery = z.infer<typeof ticketListQuery>;

export const eligibleRoomsQuery = z.object({
  routingKind: z.enum(maintenanceRoutingKinds),
});

export type EligibleRoomsQuery = z.infer<typeof eligibleRoomsQuery>;

export const ticketCreateBody = z
  .object({
    routingKind: z.enum(maintenanceRoutingKinds),
    roomId: z.string().uuid().nullable().optional(),
    locationDescription: z.string().trim().min(1).max(1000),
    subject: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1).max(20000),
    imageIds: z.array(z.string().uuid()).max(IMAGE_COUNT_CAPS.CREATE_TICKET.max).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.routingKind === 'COMMON_AREA') {
      if (value.roomId !== undefined && value.roomId !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['roomId'],
          message: 'Common area tickets must not select a room.',
        });
      }
      return;
    }
    if (value.roomId === undefined || value.roomId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['roomId'],
        message: 'Room tickets must select exactly one eligible room.',
      });
    }
  });

export type TicketCreateBody = z.infer<typeof ticketCreateBody>;

export const ticketTransitionBody = z
  .object({
    status: z.enum(maintenanceStatuses),
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'REJECTED' && value.reason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A reason is required when rejecting a ticket.',
      });
    }
  });

export type TicketTransitionBody = z.infer<typeof ticketTransitionBody>;

export const ticketCommentBody = z
  .object({
    body: z.string().trim().min(1).max(20000),
    imageIds: z.array(z.string().uuid()).max(IMAGE_COUNT_CAPS.ADD_TICKET_COMMENT.max).default([]),
  })
  .strict();

export type TicketCommentBody = z.infer<typeof ticketCommentBody>;

export function parseWithFieldErrors<T>(schema: z.ZodType<T>, value: unknown): T {
  return sharedParseWithFieldErrors(schema, value);
}
