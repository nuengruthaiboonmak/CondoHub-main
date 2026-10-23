import { z } from 'zod';
import { parseWithFieldErrors as sharedParseWithFieldErrors } from '@/shared/utils/parseBody';

export const roomListQuery = z.object({
  query: z.string().trim().max(255).optional(),
  buildingId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type RoomListQuery = z.infer<typeof roomListQuery>;

export const memberAddBody = z
  .object({
    userId: z.string().min(1).optional(),
    username: z.string().min(1).max(30).optional(),
    email: z.string().email().max(255).optional(),
    name: z.string().min(1).max(255).optional(),
    phone: z.string().max(32).optional(),
    memberRole: z.enum(['MAIN', 'SUB']),
    tenancyId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type MemberAddBody = z.infer<typeof memberAddBody>;

export const memberPatchBody = z
  .object({
    action: z.enum(['END']),
  })
  .strict();

export type MemberPatchBody = z.infer<typeof memberPatchBody>;

export const coOwnerGrantBody = z
  .object({
    userId: z.string().min(1).optional(),
    username: z.string().min(1).max(30).optional(),
    email: z.string().email().max(255).optional(),
    name: z.string().min(1).max(255).optional(),
    phone: z.string().max(32).optional(),
  })
  .strict();

export type CoOwnerGrantBody = z.infer<typeof coOwnerGrantBody>;

export const ownershipAdminBody = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('TRANSFER'),
      fromUserId: z.string().min(1),
      toUserId: z.string().min(1).optional(),
      toUsername: z.string().min(1).max(30).optional(),
      effectiveAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal('REMOVE'),
      ownershipId: z.string().uuid(),
      effectiveAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal('CORRECT'),
      ownershipId: z.string().uuid(),
      startAt: z.string().datetime({ offset: true }).optional(),
      endAt: z.string().datetime({ offset: true }).nullable().optional(),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);

export type OwnershipAdminBody = z.infer<typeof ownershipAdminBody>;

export const ownerAssignBody = z
  .object({
    userId: z.string().min(1).optional(),
    username: z.string().min(1).max(30).optional(),
    email: z.string().email().max(255).optional(),
    name: z.string().min(1).max(255).optional(),
    phone: z.string().max(32).optional(),
    effectiveAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type OwnerAssignBody = z.infer<typeof ownerAssignBody>;

export const buildingBody = z
  .object({
    projectId: z.string().uuid(),
    code: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(255),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  })
  .strict();

export type BuildingBody = z.infer<typeof buildingBody>;

export const floorBody = z
  .object({
    buildingId: z.string().uuid(),
    code: z.string().trim().min(1).max(64).optional(),
    label: z.string().trim().min(1).max(255),
  })
  .strict();

export type FloorBody = z.infer<typeof floorBody>;

export const floorPatchBody = z
  .object({
    code: z.string().trim().min(1).max(64).optional(),
    label: z.string().trim().min(1).max(255).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();

export type FloorPatchBody = z.infer<typeof floorPatchBody>;

export const buildingPatchBody = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: 'Provide a name or status to update.',
  });

export type BuildingPatchBody = z.infer<typeof buildingPatchBody>;

export const roomBody = z
  .object({
    floorId: z.string().uuid(),
    buildingId: z.string().uuid(),
    roomCode: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    areaSqm: z.string().regex(/^\d+(\.\d{1,4})?$/),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.roomCode !== undefined, {
    message: 'Room name is required.',
    path: ['name'],
  });

export type RoomBody = z.infer<typeof roomBody>;

export const roomPatchBody = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    areaSqm: z
      .string()
      .regex(/^\d+(\.\d{1,4})?$/)
      .optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();

export type RoomPatchBody = z.infer<typeof roomPatchBody>;

export const tenancyBody = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    managementMode: z.enum(['PROJECT_MANAGED', 'PRIVATE_OWNER_MANAGED']),
  })
  .strict();

export type TenancyBody = z.infer<typeof tenancyBody>;

export const tenancyPatchBody = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('END'),
      endsAt: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
  z.object({ action: z.literal('CANCEL') }).strict(),
]);

export type TenancyPatchBody = z.infer<typeof tenancyPatchBody>;

export function parseWithFieldErrors<T>(schema: z.ZodType<T>, value: unknown): T {
  return sharedParseWithFieldErrors(schema, value);
}
