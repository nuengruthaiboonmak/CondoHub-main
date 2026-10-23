import { z } from 'zod';

export const maintenanceRoutingKindOptions = [
  'COMMON_AREA',
  'PRIVATE_OWNER',
  'PROJECT_MANAGED_PRIVATE',
] as const;

export type MaintenanceRoutingKindOption = (typeof maintenanceRoutingKindOptions)[number];

export const ticketCreateFormSchema = z
  .object({
    routingKind: z.enum(maintenanceRoutingKindOptions),
    roomId: z.string().uuid().optional().or(z.literal('')),
    locationDescription: z.string().trim().min(1, 'Describe where the problem is.').max(1000),
    subject: z.string().trim().min(1, 'A short subject is required.').max(255),
    description: z.string().trim().min(1, 'Describe the problem in detail.').max(20000),
  })
  .superRefine((value, ctx) => {
    if (value.routingKind === 'COMMON_AREA') return;
    if (value.roomId === undefined || value.roomId === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['roomId'],
        message: 'Select the room this request belongs to.',
      });
    }
  });

export type TicketCreateFormValues = z.infer<typeof ticketCreateFormSchema>;

export const ticketCommentFormSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment first.').max(20000),
});

export type TicketCommentFormValues = z.infer<typeof ticketCommentFormSchema>;

export const ticketTransitionFormSchema = z
  .object({
    status: z.enum([
      'PENDING',
      'IN_PROGRESS',
      'WAITING_FOR_INFO',
      'COMPLETED',
      'REJECTED',
      'CANCELLED',
    ]),
    reason: z.string().trim().max(2000).optional().or(z.literal('')),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'REJECTED' && (value.reason === undefined || value.reason === '')) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A reason is required when rejecting a request.',
      });
    }
  });

export type TicketTransitionFormValues = z.infer<typeof ticketTransitionFormSchema>;
