import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '@/modules/identity-access/infrastructure/betterAuthSchema';
import { room } from '@/modules/property-membership/infrastructure/schema';

export const maintenanceRoutingKind = pgEnum('maintenance_routing_kind', [
  'COMMON_AREA',
  'PRIVATE_OWNER',
  'PROJECT_MANAGED_PRIVATE',
]);

export type MaintenanceRoutingKind = (typeof maintenanceRoutingKind.enumValues)[number];

export const maintenanceStatus = pgEnum('maintenance_status', [
  'PENDING',
  'IN_PROGRESS',
  'WAITING_FOR_INFO',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
]);

export type MaintenanceStatus = (typeof maintenanceStatus.enumValues)[number];

export const maintenanceRequest = pgTable(
  'maintenance_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id').references(() => room.id, { onDelete: 'restrict' }),
    locationDescription: text('location_description').notNull(),
    routingKind: maintenanceRoutingKind('routing_kind').notNull(),
    status: maintenanceStatus('status').notNull(),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    version: integer('version').notNull(),
    snapshotBoundaryAt: timestamp('snapshot_boundary_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'maintenance_request_routing_room_ck',
      sql`("routing_kind" = 'COMMON_AREA' AND "room_id" IS NULL) OR ("routing_kind" IN ('PRIVATE_OWNER', 'PROJECT_MANAGED_PRIVATE') AND "room_id" IS NOT NULL)`,
    ),
    index('maintenance_request_reporter_status_created_idx').on(
      table.reporterId,
      table.status,
      table.createdAt,
    ),
    index('maintenance_request_room_routing_created_idx').on(
      table.roomId,
      table.routingKind,
      table.createdAt,
    ),
  ],
);

export type MaintenanceRequestRow = typeof maintenanceRequest.$inferSelect;
export type MaintenanceRequestInsert = typeof maintenanceRequest.$inferInsert;

export const maintenanceComment = pgTable(
  'maintenance_comment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => maintenanceRequest.id, { onDelete: 'restrict' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('maintenance_comment_request_created_idx').on(
      table.requestId,
      table.createdAt,
      table.id,
    ),
  ],
);

export type MaintenanceCommentRow = typeof maintenanceComment.$inferSelect;
export type MaintenanceCommentInsert = typeof maintenanceComment.$inferInsert;

export const maintenanceStatusHistory = pgTable(
  'maintenance_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => maintenanceRequest.id, { onDelete: 'restrict' }),
    fromState: text('from_state').notNull(),
    toState: text('to_state').notNull(),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('maintenance_status_history_request_idx').on(table.requestId)],
);

export type MaintenanceStatusHistoryRow = typeof maintenanceStatusHistory.$inferSelect;
export type MaintenanceStatusHistoryInsert = typeof maintenanceStatusHistory.$inferInsert;

export const maintenanceRecipient = pgTable(
  'maintenance_recipient',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => maintenanceRequest.id, { onDelete: 'restrict' }),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    ownershipIntervalRef: uuid('ownership_interval_ref'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
    assignedBy: text('assigned_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    unique('maintenance_recipient_request_user_uq').on(table.requestId, table.recipientUserId),
  ],
);

export type MaintenanceRecipientRow = typeof maintenanceRecipient.$inferSelect;
export type MaintenanceRecipientInsert = typeof maintenanceRecipient.$inferInsert;
