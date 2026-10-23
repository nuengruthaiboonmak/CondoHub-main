import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    requestId: text('request_id').notNull(),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('audit_log_resource_idx').on(table.resourceType, table.resourceId, table.at),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type AuditLogInsert = typeof auditLog.$inferInsert;
