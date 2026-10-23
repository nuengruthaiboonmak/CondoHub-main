import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '@/modules/identity-access/infrastructure/betterAuthSchema';
import {
  room,
  rentalPeriod,
} from '@/modules/property-membership/infrastructure/schema';
import { imageAttachment } from '@/modules/media-attachments/infrastructure/schema';

export const invoiceKind = pgEnum('invoice_kind', [
  'PRIVATE_RENT',
  'PROJECT_MANAGED_RENT',
  'COMMON_FEE',
]);

export type InvoiceKind = (typeof invoiceKind.enumValues)[number];

export const feeConfigMode = pgEnum('fee_config_mode', ['FIXED_PROJECT', 'AREA', 'PER_ROOM']);

export type FeeConfigMode = (typeof feeConfigMode.enumValues)[number];

export const feeFrequency = pgEnum('fee_frequency', [
  'MONTHLY',
  'QUARTERLY',
  'HALF_YEARLY',
  'YEARLY',
  'ONE_TIME',
]);

export type FeeFrequency = (typeof feeFrequency.enumValues)[number];

export const turnoverReviewState = pgEnum('turnover_review_state', [
  'UNRESOLVED',
  'RESOLVED',
  'NO_CHARGE',
]);

export type TurnoverReviewState = (typeof turnoverReviewState.enumValues)[number];

export const turnoverDecisionType = pgEnum('turnover_decision_type', [
  'ISSUE_INVOICES',
  'NO_CHARGE',
]);

export type TurnoverDecisionType = (typeof turnoverDecisionType.enumValues)[number];

export const reviewerSnapshotSource = pgEnum('reviewer_snapshot_source', [
  'ISSUE_TIME',
  'TURNOVER_REVIEW',
]);

export type ReviewerSnapshotSource = (typeof reviewerSnapshotSource.enumValues)[number];

export const chargeEventStatus = pgEnum('charge_event_status', ['OPEN', 'ISSUED', 'CANCELLED']);

export type ChargeEventStatus = (typeof chargeEventStatus.enumValues)[number];

export const paymentSubmissionState = pgEnum('payment_submission_state', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

export type PaymentSubmissionState = (typeof paymentSubmissionState.enumValues)[number];

export const billingRule = pgTable(
  'billing_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: invoiceKind('kind').notNull(),
    roomId: uuid('room_id').references(() => room.id, { onDelete: 'restrict' }),
    configMode: feeConfigMode('config_mode').notNull(),
    rate: numeric('rate'),
    frequency: feeFrequency('frequency').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    enabled: boolean('enabled').notNull(),
  },
  (table) => [
    index('billing_rule_kind_idx').on(table.kind),
    index('billing_rule_room_idx').on(table.roomId),
  ],
);

export type BillingRuleRow = typeof billingRule.$inferSelect;
export type BillingRuleInsert = typeof billingRule.$inferInsert;

export const turnoverBillingReview = pgTable(
  'turnover_billing_review',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    calendarMonth: date('calendar_month').notNull(),
    cycleStart: timestamp('cycle_start', { withTimezone: true }).notNull(),
    cycleTimezone: text('cycle_timezone').notNull(),
    managementModeAtCreation: text('management_mode_at_creation').notNull(),
    state: turnoverReviewState('state').notNull(),
    candidateTenancyIds: uuid('candidate_tenancy_ids').array().notNull(),
    candidateContext: jsonb('candidate_context'),
    version: integer('version').notNull(),
    decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionType: turnoverDecisionType('decision_type'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('turnover_review_room_month_uq').on(table.roomId, table.calendarMonth),
    check(
      'turnover_review_month_day_ck',
      sql`EXTRACT(DAY FROM "calendar_month") = 1`,
    ),
    index('turnover_review_room_state_idx').on(table.roomId, table.state),
  ],
);

export type TurnoverBillingReviewRow = typeof turnoverBillingReview.$inferSelect;
export type TurnoverBillingReviewInsert = typeof turnoverBillingReview.$inferInsert;

export const turnoverReviewResponsibleOwner = pgTable(
  'turnover_review_responsible_owner',
  {
    reviewId: uuid('review_id')
      .notNull()
      .references(() => turnoverBillingReview.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    ownershipIntervalRef: uuid('ownership_interval_ref'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.reviewId, table.userId] })],
);

export type TurnoverReviewResponsibleOwnerRow =
  typeof turnoverReviewResponsibleOwner.$inferSelect;
export type TurnoverReviewResponsibleOwnerInsert =
  typeof turnoverReviewResponsibleOwner.$inferInsert;

export const commonFeeChargeEvent = pgTable(
  'common_fee_charge_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRuleId: uuid('source_rule_id').references(() => billingRule.id, {
      onDelete: 'set null',
    }),
    eventEffectiveDate: date('event_effective_date').notNull(),
    projectTimezone: text('project_timezone'),
    configuredAmount: bigint('configured_amount', { mode: 'bigint' }),
    chargeContext: jsonb('charge_context'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    status: chargeEventStatus('status').notNull(),
  },
  (table) => [index('charge_event_effective_idx').on(table.eventEffectiveDate)],
);

export type CommonFeeChargeEventRow = typeof commonFeeChargeEvent.$inferSelect;
export type CommonFeeChargeEventInsert = typeof commonFeeChargeEvent.$inferInsert;

export const invoice = pgTable(
  'invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    tenancyId: uuid('tenancy_id').references(() => rentalPeriod.id, { onDelete: 'restrict' }),
    kind: invoiceKind('kind').notNull(),
    sourceRuleId: uuid('source_rule_id').references(() => billingRule.id, {
      onDelete: 'set null',
    }),
    sourceTurnoverReviewId: uuid('source_turnover_review_id').references(
      () => turnoverBillingReview.id,
      { onDelete: 'restrict' },
    ),
    reviewerSnapshotSource: reviewerSnapshotSource('reviewer_snapshot_source'),
    oneTimeChargeEventId: uuid('one_time_charge_event_id').references(
      () => commonFeeChargeEvent.id,
      { onDelete: 'set null' },
    ),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    serviceStart: timestamp('service_start', { withTimezone: true }).notNull(),
    serviceEndExclusive: timestamp('service_end_exclusive', { withTimezone: true }).notNull(),
    total: bigint('total', { mode: 'bigint' }).notNull(),
    dueDate: date('due_date').notNull(),
    snapshotBoundaryAt: timestamp('snapshot_boundary_at', { withTimezone: true }).notNull(),
    snapshotTimezone: text('snapshot_timezone').notNull(),
    issuerId: text('issuer_id').references(() => user.id, { onDelete: 'set null' }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    paymentInstructionSnapshot: jsonb('payment_instruction_snapshot'),
    ownershipIntervalRef: uuid('ownership_interval_ref'),
    version: integer('version').notNull(),
    pastDueDateConfirmed: boolean('past_due_date_confirmed'),
    pastDueDateConfirmedAt: timestamp('past_due_date_confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoice_rent_natural_puq')
      .on(table.roomId, table.kind, table.periodStart, table.tenancyId)
      .where(sql`"kind" IN ('PRIVATE_RENT', 'PROJECT_MANAGED_RENT')`),
    uniqueIndex('invoice_common_recurring_puq')
      .on(table.sourceRuleId, table.roomId, table.periodStart)
      .where(sql`"kind" = 'COMMON_FEE' AND "one_time_charge_event_id" IS NULL`),
    uniqueIndex('invoice_common_onetime_puq')
      .on(table.oneTimeChargeEventId, table.roomId)
      .where(sql`"one_time_charge_event_id" IS NOT NULL`),
    check('invoice_total_nonnegative_ck', sql`"total" >= 0`),
    check(
      'invoice_rent_shape_ck',
      sql`("kind" NOT IN ('PRIVATE_RENT', 'PROJECT_MANAGED_RENT')) OR ("tenancy_id" IS NOT NULL AND "one_time_charge_event_id" IS NULL)`,
    ),
    check(
      'invoice_common_recurring_shape_ck',
      sql`("kind" != 'COMMON_FEE') OR ("one_time_charge_event_id" IS NOT NULL) OR ("source_rule_id" IS NOT NULL AND "tenancy_id" IS NULL)`,
    ),
    check(
      'invoice_onetime_shape_ck',
      sql`("one_time_charge_event_id" IS NULL) OR ("kind" = 'COMMON_FEE' AND "tenancy_id" IS NULL)`,
    ),
    index('invoice_due_date_idx').on(table.dueDate),
    index('invoice_room_kind_period_idx').on(table.roomId, table.kind, table.periodStart),
    index('invoice_service_range_idx').on(table.serviceStart, table.serviceEndExclusive),
  ],
);

export type InvoiceRow = typeof invoice.$inferSelect;
export type InvoiceInsert = typeof invoice.$inferInsert;

export const privateRentInvoiceReviewer = pgTable(
  'private_rent_invoice_reviewer',
  {
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    ownershipIntervalRef: uuid('ownership_interval_ref'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.invoiceId, table.userId] })],
);

export type PrivateRentInvoiceReviewerRow = typeof privateRentInvoiceReviewer.$inferSelect;
export type PrivateRentInvoiceReviewerInsert = typeof privateRentInvoiceReviewer.$inferInsert;

export const commonFeeInvoiceResponsibleOwner = pgTable(
  'common_fee_invoice_responsible_owner',
  {
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    ownershipIntervalRef: uuid('ownership_interval_ref'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.invoiceId, table.userId] })],
);

export type CommonFeeInvoiceResponsibleOwnerRow =
  typeof commonFeeInvoiceResponsibleOwner.$inferSelect;
export type CommonFeeInvoiceResponsibleOwnerInsert =
  typeof commonFeeInvoiceResponsibleOwner.$inferInsert;

export const invoiceRevision = pgTable('invoice_revision', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoice.id, { onDelete: 'restrict' }),
  oldTotal: bigint('old_total', { mode: 'bigint' }).notNull(),
  newTotal: bigint('new_total', { mode: 'bigint' }).notNull(),
  reason: text('reason'),
  actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});

export type InvoiceRevisionRow = typeof invoiceRevision.$inferSelect;
export type InvoiceRevisionInsert = typeof invoiceRevision.$inferInsert;

export const paymentSubmission = pgTable(
  'payment_submission',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'restrict' }),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    imageId: uuid('image_id')
      .notNull()
      .references(() => imageAttachment.id, { onDelete: 'restrict' }),
    state: paymentSubmissionState('state').notNull(),
    approvedAmount: bigint('approved_amount', { mode: 'bigint' }),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
  },
  (table) => [
    uniqueIndex('payment_submission_pending_puq')
      .on(table.invoiceId)
      .where(sql`"state" = 'PENDING'`),
    check(
      'payment_submission_approved_positive_ck',
      sql`"approved_amount" IS NULL OR "approved_amount" > 0`,
    ),
  ],
);

export type PaymentSubmissionRow = typeof paymentSubmission.$inferSelect;
export type PaymentSubmissionInsert = typeof paymentSubmission.$inferInsert;

export const paymentInstruction = pgTable('payment_instruction', {
  id: uuid('id').primaryKey().defaultRandom(),
  payeeType: text('payee_type').notNull(),
  payeeId: uuid('payee_id').notNull(),
  bankName: text('bank_name').notNull(),
  accountName: text('account_name').notNull(),
  accountNumber: text('account_number').notNull(),
  qrImageId: uuid('qr_image_id').references(() => imageAttachment.id, { onDelete: 'set null' }),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
});

export type PaymentInstructionRow = typeof paymentInstruction.$inferSelect;
export type PaymentInstructionInsert = typeof paymentInstruction.$inferInsert;
