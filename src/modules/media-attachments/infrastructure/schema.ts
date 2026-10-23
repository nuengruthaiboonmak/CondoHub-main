import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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

export const imageScope = pgEnum('image_scope', [
  'PAYMENT_SLIP',
  'PAYMENT_QR',
  'MAINTENANCE',
  'ANNOUNCEMENT',
  'CHAT',
]);

export type ImageScopeValue = (typeof imageScope.enumValues)[number];

export const imageState = pgEnum('image_state', [
  'PENDING',
  'UPLOADED',
  'READY',
  'REJECTED',
  'ORPHANED',
]);

export type ImageStateValue = (typeof imageState.enumValues)[number];

export const imageAttachment = pgTable(
  'image_attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    objectKey: text('object_key').notNull(),
    scope: imageScope('scope').notNull(),
    mime: text('mime').notNull(),
    mimeVerified: boolean('mime_verified').notNull().default(false),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    sha256: text('sha256'),
    width: integer('width'),
    height: integer('height'),
    state: imageState('state').notNull().default('PENDING'),
    ownerEntityType: text('owner_entity_type'),
    ownerEntityId: uuid('owner_entity_id'),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    unique('image_attachment_object_key_uq').on(table.objectKey),
    check(
      'image_attachment_owner_pair_ck',
      sql`("owner_entity_type" IS NULL AND "owner_entity_id" IS NULL) OR ("owner_entity_type" IS NOT NULL AND "owner_entity_id" IS NOT NULL)`,
    ),
    index('image_attachment_sweeper_idx').on(table.scope, table.state, table.createdAt),
    index('image_attachment_owner_idx').on(table.ownerEntityType, table.ownerEntityId),
  ],
);

export type ImageAttachmentRow = typeof imageAttachment.$inferSelect;
export type ImageAttachmentInsert = typeof imageAttachment.$inferInsert;
