import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { createS3Client, readS3Settings } from '@/shared/storage/s3Client';
import { assertSeedAllowed, loadDotenv, parseRunId } from './seed-common';

loadDotenv('.env.local');

interface ResetTarget {
  label: string;
  sql: string;
  pattern: 'raw' | 'normalized' | 'keys';
}

const BILLING_JOB_KEYS = [
  '2026-07',
  '2025-10:2025-12',
  '2026-01:2026-03',
  '2026-04',
  '2026-09',
  '2026-02',
  '2024-02',
  '2026-08',
  '2026-05',
  '2026-03',
  '2026-06',
  '2026-10',
  '2026-11',
  '2026-12',
  '2027-01',
  '2027-02',
  '2027-03',
  '2027-04',
  '2027-05',
  '2027-06',
  '2027-07',
  '2027-08',
];

function bangkokYearMonth(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).format(at);
}

function billingJobKeys(now: Date): string[] {
  const current = bangkokYearMonth(now);
  const previous = bangkokYearMonth(new Date(now.getTime() - 32 * 86_400_000));
  return [...BILLING_JOB_KEYS, current, previous];
}

function resetTargets(): ResetTarget[] {
  return [
    {
      label: 'chat_message',
      sql: `DELETE FROM "chat_message" WHERE "conversation_id" IN (SELECT "id" FROM "room_conversation" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'chat_message_by_run_user',
      sql: `DELETE FROM "chat_message" WHERE "sender_user_id" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'normalized',
    },
    {
      label: 'room_conversation',
      sql: `DELETE FROM "room_conversation" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'ticket_comment_idempotency',
      sql: `DELETE FROM "idempotency_key" WHERE "scope" = 'TICKET_COMMENT' AND "result_ref_id" IN (SELECT "id" FROM "maintenance_comment" WHERE "request_id" IN (SELECT "id" FROM "maintenance_request" WHERE "reporter_id" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\')))`,
      pattern: 'normalized',
    },
    {
      label: 'ticket_create_idempotency_room',
      sql: `DELETE FROM "idempotency_key" WHERE "scope" = 'TICKET_CREATE' AND "result_ref_id" IN (SELECT "id" FROM "maintenance_request" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'ticket_create_idempotency_reporter',
      sql: `DELETE FROM "idempotency_key" WHERE "scope" = 'TICKET_CREATE' AND "result_ref_id" IN (SELECT "id" FROM "maintenance_request" WHERE "reporter_id" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'normalized',
    },
    {
      label: 'maintenance_comment',
      sql: `DELETE FROM "maintenance_comment" WHERE "request_id" IN (SELECT "id" FROM "maintenance_request" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\') OR "reporter_id" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'maintenance_comment_by_run_user',
      sql: `DELETE FROM "maintenance_comment" WHERE "request_id" IN (SELECT "id" FROM "maintenance_request" WHERE "reporter_id" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'normalized',
    },
    {
      label: 'maintenance_status_history',
      sql: `DELETE FROM "maintenance_status_history" WHERE "request_id" IN (SELECT "id" FROM "maintenance_request" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'maintenance_status_history_by_run_user',
      sql: `DELETE FROM "maintenance_status_history" WHERE "request_id" IN (SELECT "id" FROM "maintenance_request" WHERE "reporter_id" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'normalized',
    },
    {
      label: 'maintenance_recipient',
      sql: `DELETE FROM "maintenance_recipient" WHERE "request_id" IN (SELECT "id" FROM "maintenance_request" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'maintenance_recipient_by_run_user',
      sql: `DELETE FROM "maintenance_recipient" WHERE "request_id" IN (SELECT "id" FROM "maintenance_request" WHERE "reporter_id" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'normalized',
    },
    {
      label: 'maintenance_request_room',
      sql: `DELETE FROM "maintenance_request" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'maintenance_request_reporter',
      sql: `DELETE FROM "maintenance_request" WHERE "reporter_id" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'normalized',
    },
    {
      label: 'payment_review_idempotency_onetime_by_run_event',
      sql: `DELETE FROM "idempotency_key" WHERE "scope" = 'PAYMENT_REVIEW' AND "result_ref_id" IN (SELECT "id" FROM "payment_submission" WHERE "invoice_id" IN (SELECT "id" FROM "invoice" WHERE "one_time_charge_event_id" IN (SELECT "id" FROM "common_fee_charge_event" WHERE "charge_context"->>'runId' = $1 OR "charge_context"->>'note' LIKE '%' || $1 || '%' ESCAPE '\\')))`,
      pattern: 'raw',
    },
    {
      label: 'payment_submission_onetime_by_run_event',
      sql: `DELETE FROM "payment_submission" WHERE "invoice_id" IN (SELECT "id" FROM "invoice" WHERE "one_time_charge_event_id" IN (SELECT "id" FROM "common_fee_charge_event" WHERE "charge_context"->>'runId' = $1 OR "charge_context"->>'note' LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'invoice_revision_onetime_by_run_event',
      sql: `DELETE FROM "invoice_revision" WHERE "invoice_id" IN (SELECT "id" FROM "invoice" WHERE "one_time_charge_event_id" IN (SELECT "id" FROM "common_fee_charge_event" WHERE "charge_context"->>'runId' = $1 OR "charge_context"->>'note' LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'common_fee_responsible_onetime_by_run_event',
      sql: `DELETE FROM "common_fee_invoice_responsible_owner" WHERE "invoice_id" IN (SELECT "id" FROM "invoice" WHERE "one_time_charge_event_id" IN (SELECT "id" FROM "common_fee_charge_event" WHERE "charge_context"->>'runId' = $1 OR "charge_context"->>'note' LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'payment_review_idempotency',
      sql: `DELETE FROM "idempotency_key" WHERE "scope" = 'PAYMENT_REVIEW' AND "result_ref_id" IN (SELECT "id" FROM "payment_submission" WHERE "invoice_id" IN (SELECT "id" FROM "invoice" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')))`,
      pattern: 'raw',
    },
    {
      label: 'payment_submission',
      sql: `DELETE FROM "payment_submission" WHERE "invoice_id" IN (SELECT "id" FROM "invoice" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'invoice_revision',
      sql: `DELETE FROM "invoice_revision" WHERE "invoice_id" IN (SELECT "id" FROM "invoice" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'private_rent_invoice_reviewer',
      sql: `DELETE FROM "private_rent_invoice_reviewer" WHERE "invoice_id" IN (SELECT "id" FROM "invoice" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'common_fee_invoice_responsible_owner',
      sql: `DELETE FROM "common_fee_invoice_responsible_owner" WHERE "invoice_id" IN (SELECT "id" FROM "invoice" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'payment_instruction_by_run_admin',
      sql: `DELETE FROM "payment_instruction" WHERE "id"::text IN (SELECT "resource_id" FROM "audit_log" WHERE "action" = 'payee_instruction.updated' AND "actor_id" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'normalized',
    },
    {
      label: 'payment_instruction',
      sql: `DELETE FROM "payment_instruction" WHERE "payee_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'idempotency_key',
      sql: `DELETE FROM "idempotency_key" WHERE "scope" = 'TURNOVER_RESOLVE' AND "result_ref_id" IN (SELECT "id" FROM "turnover_billing_review" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'turnover_review_responsible_owner',
      sql: `DELETE FROM "turnover_review_responsible_owner" WHERE "review_id" IN (SELECT "id" FROM "turnover_billing_review" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'))`,
      pattern: 'raw',
    },
    {
      label: 'invoice_onetime_by_run_event',
      sql: `DELETE FROM "invoice" WHERE "one_time_charge_event_id" IN (SELECT "id" FROM "common_fee_charge_event" WHERE "charge_context"->>'runId' = $1 OR "charge_context"->>'note' LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'invoice',
      sql: `DELETE FROM "invoice" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'turnover_billing_review',
      sql: `DELETE FROM "turnover_billing_review" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'common_fee_charge_event',
      sql: `DELETE FROM "common_fee_charge_event" WHERE "charge_context"->>'runId' = $1 OR "charge_context"->>'note' LIKE '%' || $1 || '%' ESCAPE '\\'`,
      pattern: 'raw',
    },
    {
      label: 'billing_rule',
      sql: `DELETE FROM "billing_rule" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'job_run',
      sql: `DELETE FROM "job_run" WHERE "job_name" = 'generate-invoices' AND "business_key" = ANY($1)`,
      pattern: 'keys',
    },
    {
      label: 'quota_adjustment',
      sql: `DELETE FROM "quota_adjustment" WHERE "facility_id" IN (SELECT "id" FROM "facility" WHERE concat_ws(' ', "code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'quota_period_lock',
      sql: `DELETE FROM "quota_period_lock" WHERE "facility_id" IN (SELECT "id" FROM "facility" WHERE concat_ws(' ', "code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'booking_slot',
      sql: `DELETE FROM "booking_slot" WHERE "facility_id" IN (SELECT "id" FROM "facility" WHERE concat_ws(' ', "code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'booking',
      sql: `DELETE FROM "booking" WHERE "facility_id" IN (SELECT "id" FROM "facility" WHERE concat_ws(' ', "code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'facility_closure',
      sql: `DELETE FROM "facility_closure" WHERE "facility_id" IN (SELECT "id" FROM "facility" WHERE concat_ws(' ', "code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'facility_config',
      sql: `DELETE FROM "facility_config" WHERE "facility_id" IN (SELECT "id" FROM "facility" WHERE concat_ws(' ', "code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'facility',
      sql: `DELETE FROM "facility" WHERE concat_ws(' ', "code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'`,
      pattern: 'raw',
    },
    {
      label: 'image_attachment',
      sql: `DELETE FROM "image_attachment" WHERE "object_key" LIKE 'e2e/%' || $1 || '%' ESCAPE '\\'`,
      pattern: 'raw',
    },
    {
      label: 'image_attachment_by_run_user',
      sql: `DELETE FROM "image_attachment" WHERE "uploaded_by" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'normalized',
    },
    {
      label: 'announcement_revision',
      sql: `DELETE FROM "announcement_revision" WHERE "announcement_id" IN (SELECT "id" FROM "announcement" WHERE "title" LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'announcement',
      sql: `DELETE FROM "announcement" WHERE "title" LIKE '%' || $1 || '%' ESCAPE '\\'`,
      pattern: 'raw',
    },
    {
      label: 'room_membership',
      sql: `DELETE FROM "room_membership" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'rental_period',
      sql: `DELETE FROM "rental_period" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'room_ownership',
      sql: `DELETE FROM "room_ownership" WHERE "room_id" IN (SELECT "id" FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'room',
      sql: `DELETE FROM "room" WHERE concat_ws(' ', "room_code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'`,
      pattern: 'raw',
    },
    {
      label: 'floor',
      sql: `DELETE FROM "floor" WHERE "code" LIKE '%' || $1 || '%' ESCAPE '\\' OR "label" LIKE '%' || $1 || '%' ESCAPE '\\' OR "building_id" IN (SELECT "id" FROM "building" WHERE concat_ws(' ', "code", "name") LIKE '%' || $1 || '%' ESCAPE '\\')`,
      pattern: 'raw',
    },
    {
      label: 'building',
      sql: `DELETE FROM "building" WHERE concat_ws(' ', "code", "name") LIKE '%' || $1 || '%' ESCAPE '\\'`,
      pattern: 'raw',
    },
    {
      label: 'user',
      sql: `DELETE FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\'`,
      pattern: 'normalized',
    },
  ];
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function normalizedRun(runId: string): string {
  return runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

async function deleteRunPrefixObjects(runId: string): Promise<number> {
  const prefix = `e2e/${runId}/`;
  const settings = readS3Settings();
  const client = createS3Client(settings);
  let deleted = 0;
  let token: string | undefined;
  for (;;) {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: settings.bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const object of listed.Contents ?? []) {
      if (object.Key === undefined || !object.Key.startsWith(prefix)) continue;
      await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: object.Key }));
      deleted += 1;
    }
    if (listed.IsTruncated !== true) return deleted;
    token = listed.NextContinuationToken;
  }
}

async function main(): Promise<void> {
  assertSeedAllowed();
  const runId = parseRunId(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === '')
    throw new Error('Missing DATABASE_URL.');
  const pool = new Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: false } });
  try {
    const raw = escapeLike(runId);
    const normalized = escapeLike(normalizedRun(runId));
    const keys = billingJobKeys(new Date());
    const uploadedObjects = await pool.query<{ object_key: string }>(
      `SELECT "object_key" FROM "image_attachment" WHERE "uploaded_by" IN (SELECT "id" FROM "user" WHERE "username" LIKE '%' || $1 || '%' ESCAPE '\\')`,
      [normalized],
    );
    for (const target of resetTargets()) {
      try {
        const param =
          target.pattern === 'normalized' ? normalized : target.pattern === 'keys' ? keys : raw;
        const result = await pool.query(target.sql, [param]);
        console.log(
          `reset ${target.label}: deleted ${result.rowCount ?? 0} rows for run ${runId}.`,
        );
      } catch (error) {
        console.log(
          `reset ${target.label}: skipped (${error instanceof Error ? error.message : 'unknown error'}).`,
        );
      }
    }
    try {
      const settings = readS3Settings();
      const client = createS3Client(settings);
      for (const object of uploadedObjects.rows)
        await client.send(
          new DeleteObjectCommand({ Bucket: settings.bucket, Key: object.object_key }),
        );
      const deleted = await deleteRunPrefixObjects(runId);
      console.log(`reset s3-prefix: deleted ${deleted} objects for run ${runId}.`);
    } catch (error) {
      console.log(
        `reset s3-prefix: skipped (${error instanceof Error ? error.message : 'unknown error'}).`,
      );
    }
  } finally {
    await pool.end();
  }
}

void main();
