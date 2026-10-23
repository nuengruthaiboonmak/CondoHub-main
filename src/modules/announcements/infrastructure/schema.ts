import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '@/modules/identity-access/infrastructure/betterAuthSchema';

export const announcement = pgTable(
  'announcement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    publishAt: timestamp('publish_at', { withTimezone: true }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [index('announcement_publish_idx').on(table.publishAt, table.id)],
);

export type AnnouncementRow = typeof announcement.$inferSelect;
export type AnnouncementInsert = typeof announcement.$inferInsert;

export const announcementRevision = pgTable(
  'announcement_revision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcement.id, { onDelete: 'restrict' }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('announcement_revision_version_uq').on(table.announcementId, table.version),
    index('announcement_revision_announcement_idx').on(table.announcementId),
  ],
);

export type AnnouncementRevisionRow = typeof announcementRevision.$inferSelect;
export type AnnouncementRevisionInsert = typeof announcementRevision.$inferInsert;
