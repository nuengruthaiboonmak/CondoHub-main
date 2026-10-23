import { index, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const idempotencyScope = pgEnum('idempotency_scope', [
  'BOOKING_CREATE',
  'PAYMENT_REVIEW',
  'TURNOVER_RESOLVE',
  'TICKET_CREATE',
  'TICKET_COMMENT',
  'CONFIG_COMMIT',
  'USER_PROVISION',
  'CO_OWNER_GRANT',
  'OWNER_ASSIGN',
]);

export type IdempotencyScope = (typeof idempotencyScope.enumValues)[number];

export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    scope: idempotencyScope('scope').notNull(),
    key: uuid('key').notNull(),
    actorId: text('actor_id'),
    requestHash: text('request_hash').notNull(),
    resultRefType: text('result_ref_type'),
    resultRefId: uuid('result_ref_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key] }),
    index('idempotency_key_expires_idx').on(table.expiresAt),
  ],
);

export type IdempotencyKeyRow = typeof idempotencyKey.$inferSelect;
export type IdempotencyKeyInsert = typeof idempotencyKey.$inferInsert;
