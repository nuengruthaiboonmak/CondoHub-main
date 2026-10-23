import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiJson } from '../../helpers/api';

export interface JobTriggerBody {
  triggerSource: 'CRON' | 'MANUAL' | 'STARTUP_DEFERRED';
  fromCycle?: string;
  toCycle?: string;
  batchSize?: number;
}

export interface GenerateJobEnvelope {
  data: {
    created: number;
    skipped: number;
    reviewRequired: number;
    caughtUp: boolean;
    nextFromCycle?: string;
  };
}

export interface AlreadyRunningEnvelope {
  data: { skipped: 'already-running' };
}

export interface InvoiceRow {
  id: string;
  roomId: string;
  tenancyId: string | null;
  kind: 'PRIVATE_RENT' | 'PROJECT_MANAGED_RENT' | 'COMMON_FEE';
  periodStart: string;
  periodEnd: string;
  total: { amount: string; currency: string };
  dueDate: string;
  issuedAt: string | null;
  version: number;
  state: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  approvedTotal: { amount: string; currency: string };
  outstanding: { amount: string; currency: string };
  overdue: boolean;
  pendingOnPaid: boolean;
}

export interface InvoiceListEnvelope {
  data: InvoiceRow[];
  meta: { page: number; pageSize: number; total: number };
}

export interface InvoiceDetailEnvelope {
  data: InvoiceRow;
}

export interface ChargeEventRow {
  id: string;
  sourceRuleId: string | null;
  eventEffectiveDate: string;
  projectTimezone: string | null;
  configuredAmount: { amount: string; currency: string } | null;
  chargeContext: unknown;
  createdBy: string | null;
  createdAt: string;
  status: 'OPEN' | 'ISSUED' | 'CANCELLED';
}

export interface ChargeEventEnvelope {
  data: ChargeEventRow;
}

export interface JobRunRow {
  id: string;
  jobName: string;
  businessKey: string;
  state: 'RUNNING' | 'DONE' | 'ERROR';
  result: Record<string, unknown> | null;
  attempt: number;
  triggerSource: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface JobRunListEnvelope {
  data: JobRunRow[];
  meta: { page: number; pageSize: number; total: number };
}

export interface JobRunDetailEnvelope {
  data: JobRunRow & { heartbeatAt: string; createdAt: string; updatedAt: string };
}

export interface ErrorEnvelope {
  error: { code: string; message: string };
}

export const REDACTED_JOB_KEYS = ['created', 'skipped', 'reviewRequired', 'caughtUp', 'nextFromCycle'];

export function jobSecret(): string {
  const value = process.env.JOB_TRIGGER_SECRET;
  if (value === undefined || value === '') {
    throw new Error('Billing E2E needs the JOB_TRIGGER_SECRET env var.');
  }
  return value;
}

let lastJobPostAt = 0;

async function paceJobPosts(): Promise<void> {
  const gapMs = 7000;
  const now = Date.now();
  const wait = gapMs - (now - lastJobPostAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastJobPostAt = Date.now();
}

export async function postJobRaw(
  request: APIRequestContext,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: unknown }> {
  await paceJobPosts();
  const response = await request.fetch('/api/internal/jobs/generate-invoices', {
    method: 'POST',
    data: body,
    headers: { 'content-type': 'application/json', ...headers },
  });
  return { status: response.status(), json: (await response.json()) as unknown };
}

export async function triggerGenerate(
  request: APIRequestContext,
  body: JobTriggerBody,
): Promise<{ status: number; json: GenerateJobEnvelope }> {
  const posted = await postJobRaw(request, body, { 'x-job-secret': jobSecret() });
  expect(posted.status).toBe(200);
  return posted as { status: number; json: GenerateJobEnvelope };
}

export function expectRedactedJobPayload(payload: unknown): void {
  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    expect(REDACTED_JOB_KEYS).toContain(key);
  }
  expect(JSON.stringify(record).toLowerCase()).not.toContain('private');
}

export async function listInvoices(
  request: APIRequestContext,
  query: { roomId?: string; kind?: string; pageSize?: number },
): Promise<InvoiceRow[]> {
  const params = new URLSearchParams();
  if (query.roomId !== undefined) params.set('roomId', query.roomId);
  if (query.kind !== undefined) params.set('kind', query.kind);
  params.set('pageSize', String(query.pageSize ?? 100));
  const listed = await apiJson<InvoiceListEnvelope>(request, {
    method: 'GET',
    path: `/api/invoices?${params.toString()}`,
  });
  expect(listed.status).toBe(200);
  return listed.json.data;
}

export async function getInvoice(
  request: APIRequestContext,
  id: string,
): Promise<InvoiceRow> {
  const detail = await apiJson<InvoiceDetailEnvelope>(request, {
    method: 'GET',
    path: `/api/invoices/${id}`,
  });
  expect(detail.status).toBe(200);
  return detail.json.data;
}

export async function postChargeEvent(
  request: APIRequestContext,
  body: unknown,
): Promise<{ status: number; json: ChargeEventEnvelope }> {
  const posted = await apiJson<ChargeEventEnvelope>(request, {
    method: 'POST',
    path: '/api/admin/billing/common-fee-events',
    body,
  });
  expect(posted.status).toBe(200);
  return posted;
}

export async function getChargeEvent(
  request: APIRequestContext,
  id: string,
): Promise<ChargeEventRow> {
  const detail = await apiJson<ChargeEventEnvelope>(request, {
    method: 'GET',
    path: `/api/admin/billing/common-fee-events/${id}`,
  });
  expect(detail.status).toBe(200);
  return detail.json.data;
}

export async function listJobRuns(
  request: APIRequestContext,
  query: { jobName?: string; state?: string; pageSize?: number } = {},
): Promise<JobRunRow[]> {
  const params = new URLSearchParams();
  if (query.jobName !== undefined) params.set('jobName', query.jobName);
  if (query.state !== undefined) params.set('state', query.state);
  params.set('pageSize', String(query.pageSize ?? 100));
  const listed = await apiJson<JobRunListEnvelope>(request, {
    method: 'GET',
    path: `/api/admin/billing/job-runs?${params.toString()}`,
  });
  expect(listed.status).toBe(200);
  return listed.json.data;
}

export async function getJobRun(
  request: APIRequestContext,
  id: string,
): Promise<JobRunDetailEnvelope['data']> {
  const detail = await apiJson<JobRunDetailEnvelope>(request, {
    method: 'GET',
    path: `/api/admin/billing/job-runs/${id}`,
  });
  expect(detail.status).toBe(200);
  return detail.json.data;
}

export async function findBillingRoom(page: Page, roomCode: string): Promise<string> {
  const listed = await apiJson<{ data: Array<{ id: string; roomCode: string }> }>(page.request, {
    method: 'GET',
    path: `/api/rooms?query=${encodeURIComponent(roomCode)}&pageSize=100`,
  });
  expect(listed.status).toBe(200);
  const found = listed.json.data.find((room) => room.roomCode === roomCode);
  if (found) return found.id;
  throw new Error(`Billing room ${roomCode} was not found.`);
}

export function invoiceCountKey(row: InvoiceRow): string {
  return `${row.roomId}|${row.kind}|${row.periodStart}|${row.tenancyId ?? ''}|${row.total.amount}`;
}

export interface TurnoverReviewRow {
  id: string;
  roomId: string;
  calendarMonth: string;
  cycleStart: string;
  cycleTimezone: string;
  managementModeAtCreation: string;
  state: 'UNRESOLVED' | 'RESOLVED' | 'NO_CHARGE';
  candidateTenancyIds: string[];
  version: number;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionType: 'ISSUE_INVOICES' | 'NO_CHARGE' | null;
  reason: string | null;
  blocked: boolean;
  invoiceIds: string[];
  createdAt: string;
}

export interface TurnoverReviewListEnvelope {
  data: TurnoverReviewRow[];
  meta: { page: number; pageSize: number; total: number; unresolvedCount: number };
}

export interface TurnoverReviewEnvelope {
  data: TurnoverReviewRow;
}

export interface ResolveInvoiceDto {
  id: string;
  tenancyId: string | null;
  kind: 'PRIVATE_RENT' | 'PROJECT_MANAGED_RENT' | 'COMMON_FEE';
  periodStart: string;
  dueDate: string;
  total: { amount: string; currency: string };
  reviewerSnapshotSource: 'ISSUE_TIME' | 'TURNOVER_REVIEW' | null;
  sourceTurnoverReviewId: string | null;
  pastDueDateConfirmed: boolean;
}

export interface ResolveTurnoverEnvelope {
  data: {
    reviewId: string;
    state: 'RESOLVED' | 'NO_CHARGE';
    version: number;
    decision: 'ISSUE_INVOICES' | 'NO_CHARGE';
    decidedBy: string;
    decidedAt: string;
    reason: string | null;
    invoices: ResolveInvoiceDto[];
  };
}

export async function listTurnoverReviews(
  request: APIRequestContext,
  query: { state?: string; pageSize?: number } = {},
): Promise<{ rows: TurnoverReviewRow[]; unresolvedCount: number; total: number }> {
  const params = new URLSearchParams();
  if (query.state !== undefined) params.set('state', query.state);
  params.set('pageSize', String(query.pageSize ?? 100));
  const listed = await apiJson<TurnoverReviewListEnvelope>(request, {
    method: 'GET',
    path: `/api/billing/turnover-reviews?${params.toString()}`,
  });
  expect(listed.status).toBe(200);
  return {
    rows: listed.json.data,
    unresolvedCount: listed.json.meta.unresolvedCount,
    total: listed.json.meta.total,
  };
}

export async function getTurnoverReview(
  request: APIRequestContext,
  id: string,
): Promise<TurnoverReviewRow> {
  const detail = await apiJson<TurnoverReviewEnvelope>(request, {
    method: 'GET',
    path: `/api/billing/turnover-reviews/${id}`,
  });
  expect(detail.status).toBe(200);
  return detail.json.data;
}

export async function postTurnoverResolve(
  request: APIRequestContext,
  id: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'POST',
    path: `/api/billing/turnover-reviews/${id}/resolve`,
    body,
    ...(idempotencyKey !== undefined ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

export interface PaymentSubmissionRow {
  id: string;
  invoiceId: string;
  state: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedBy: string;
  imageId: string;
  approvedAmount: { amount: string; currency: string } | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}

export interface InvoiceRevisionRow {
  id: string;
  invoiceId: string;
  oldTotal: { amount: string; currency: string };
  newTotal: { amount: string; currency: string };
  reason: string | null;
  actorId: string | null;
  changedAt: string;
}

export interface PaymentInstructionRow {
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageId: string | null;
}

export interface PaymentSubmissionsEnvelope {
  data: { submissions: PaymentSubmissionRow[] };
}

export interface InvoiceRevisionsEnvelope {
  data: { revisions: InvoiceRevisionRow[] };
}

export interface PaymentInstructionEnvelope {
  data: { instruction: PaymentInstructionRow };
}

export interface PaymentSubmitEnvelope {
  data: PaymentSubmissionRow;
}

export interface PaymentReviewEnvelope {
  data: PaymentSubmissionRow & {
    invoiceState: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
    outstanding: { amount: string; currency: string };
    overdue: boolean;
    pendingOnPaid: boolean;
  };
}

export interface InvoiceEditEnvelope {
  data: {
    id: string;
    version: number;
    total: { amount: string; currency: string };
    approvedTotal: { amount: string; currency: string };
    outstanding: { amount: string; currency: string };
    state: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
    overdue: boolean;
    pendingOnPaid: boolean;
    reason: string | null;
  };
}

export async function postSubmission(
  request: APIRequestContext,
  invoiceId: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'POST',
    path: `/api/invoices/${invoiceId}/submissions`,
    body,
  });
}

export async function patchInvoice(
  request: APIRequestContext,
  invoiceId: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'PATCH',
    path: `/api/invoices/${invoiceId}`,
    body,
  });
}

export async function postApprove(
  request: APIRequestContext,
  submissionId: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'POST',
    path: `/api/payment-submissions/${submissionId}/approve`,
    body,
    ...(idempotencyKey !== undefined ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

export async function postReject(
  request: APIRequestContext,
  submissionId: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'POST',
    path: `/api/payment-submissions/${submissionId}/reject`,
    body,
    ...(idempotencyKey !== undefined ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

export async function getPayments(
  request: APIRequestContext,
  invoiceId: string,
  view?: 'revisions' | 'instruction',
): Promise<{ status: number; json: unknown }> {
  const suffix = view === undefined ? '' : `?view=${view}`;
  return apiJson<unknown>(request, {
    method: 'GET',
    path: `/api/invoices/${invoiceId}/payments${suffix}`,
  });
}
