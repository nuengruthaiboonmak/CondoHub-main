import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const jobRunState = pgEnum('job_run_state', ['RUNNING', 'DONE', 'ERROR']);

export type JobRunState = (typeof jobRunState.enumValues)[number];

export const JOB_NAMES = ['generate-invoices', 'sweep-orphans'] as const;

export type JobName = (typeof JOB_NAMES)[number];

export const jobRun = pgTable(
  'job_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobName: text('job_name').notNull(),
    businessKey: text('business_key').notNull(),
    state: jobRunState('state').notNull(),
    payload: jsonb('payload'),
    result: jsonb('result'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    attempt: integer('attempt').notNull(),
    triggerSource: text('trigger_source').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('job_run_name_key_uq').on(table.jobName, table.businessKey)],
);

export type JobRunRow = typeof jobRun.$inferSelect;
export type JobRunInsert = typeof jobRun.$inferInsert;
