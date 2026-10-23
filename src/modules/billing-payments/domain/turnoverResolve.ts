import { AppError } from '@/shared/utils/errors';
import { feeAmountSatang, type FeeConfigMode } from './feeCalc';

export type TurnoverDecisionKind = 'ISSUE_INVOICES' | 'NO_CHARGE';

export type TurnoverReviewLifecycle = 'UNRESOLVED' | 'RESOLVED' | 'NO_CHARGE';

export interface PerInvoiceTerms {
  tenancyId: string;
  dueDate: string;
  confirmPastDueDate?: boolean | undefined;
  amountOverrideSatang?: bigint | null | undefined;
  overrideReason?: string | null | undefined;
}

export interface IssueInvoicesDecision {
  decision: 'ISSUE_INVOICES';
  selectedTenancyIds: string[];
  perInvoice: PerInvoiceTerms[];
  expectedVersion: number;
}

export interface NoChargeDecision {
  decision: 'NO_CHARGE';
  selectedTenancyIds: [];
  reason: string;
  expectedVersion: number;
}

export type TurnoverResolveDecision = IssueInvoicesDecision | NoChargeDecision;

const CALENDAR_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isCalendarValidDate(value: string): boolean {
  if (!CALENDAR_DATE_REGEX.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function assertIssueSelection(input: {
  selectedTenancyIds: string[];
  perInvoice: { tenancyId: string }[];
  candidateTenancyIds: string[];
}): void {
  if (input.selectedTenancyIds.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'At least one tenancy must be selected.');
  }
  if (new Set(input.selectedTenancyIds).size !== input.selectedTenancyIds.length) {
    throw new AppError('VALIDATION_ERROR', 'The selected tenancies must be unique.');
  }
  const candidates = new Set(input.candidateTenancyIds);
  for (const selected of input.selectedTenancyIds) {
    if (!candidates.has(selected)) {
      throw new AppError('VALIDATION_ERROR', 'Every selected tenancy must belong to the review.');
    }
  }
  const perInvoiceIds = input.perInvoice.map((entry) => entry.tenancyId);
  if (new Set(perInvoiceIds).size !== perInvoiceIds.length) {
    throw new AppError('VALIDATION_ERROR', 'The per-invoice tenancies must be unique.');
  }
  const selected = new Set(input.selectedTenancyIds);
  if (perInvoiceIds.length !== selected.size || perInvoiceIds.some((id) => !selected.has(id))) {
    throw new AppError(
      'VALIDATION_ERROR',
      'set(perInvoice[].tenancyId) must equal set(selectedTenancyIds) exactly',
    );
  }
}

export function assertNoChargeSelection(input: {
  selectedTenancyIds: string[];
  reason: string;
}): void {
  if (input.selectedTenancyIds.length !== 0) {
    throw new AppError('VALIDATION_ERROR', 'No charge must select no tenancies.');
  }
  if (input.reason.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The no-charge reason must not be blank.');
  }
}

export function assertDueDateCalendarValid(dueDate: string): void {
  if (!isCalendarValidDate(dueDate)) {
    throw new AppError('VALIDATION_ERROR', 'The due date must be a valid YYYY-MM-DD date.');
  }
}

export type PastDueDateCheck =
  | { past: false }
  | { past: true; confirmed: boolean };

export function checkPastDueDate(input: {
  dueDate: string;
  issueDate: string;
  confirmPastDueDate?: boolean | undefined;
}): PastDueDateCheck {
  assertDueDateCalendarValid(input.dueDate);
  assertDueDateCalendarValid(input.issueDate);
  if (input.dueDate >= input.issueDate) return { past: false };
  return { past: true, confirmed: input.confirmPastDueDate === true };
}

export function assertPastDueDateConfirmed(input: {
  dueDate: string;
  issueDate: string;
  confirmPastDueDate?: boolean | undefined;
}): boolean {
  const check = checkPastDueDate(input);
  if (check.past && !check.confirmed) {
    throw new AppError('PAST_DUE_DATE_CONFIRMATION_REQUIRED');
  }
  return check.past;
}

export function assertResolvableState(state: TurnoverReviewLifecycle): void {
  if (state !== 'UNRESOLVED') {
    throw new AppError('VERSION_CONFLICT', 'The review was already resolved.');
  }
}

export function assertExpectedVersion(input: { expected: number; actual: number }): void {
  if (input.expected !== input.actual) throw new AppError('VERSION_CONFLICT');
}

export interface TurnoverRentRule {
  configMode: FeeConfigMode;
  rate: string | null;
}

export function deriveRentTotalSatang(rule: TurnoverRentRule, roomAreaSqm: string): bigint {
  return feeAmountSatang({ configMode: rule.configMode, rate: rule.rate, roomAreaSqm });
}

export interface OverrideResolution {
  totalSatang: bigint;
  overridden: boolean;
}

export function resolveInvoiceTotal(input: {
  derivedSatang: bigint;
  amountOverrideSatang?: bigint | null | undefined;
  overrideReason?: string | null | undefined;
  actorIsSystemAdmin: boolean;
}): OverrideResolution {
  if (input.amountOverrideSatang === undefined || input.amountOverrideSatang === null) {
    return { totalSatang: input.derivedSatang, overridden: false };
  }
  if (!input.actorIsSystemAdmin) throw new AppError('ACCESS_DENIED');
  if (input.amountOverrideSatang < 0n) {
    throw new AppError('VALIDATION_ERROR', 'The override amount must not be negative.');
  }
  if (input.overrideReason === undefined || input.overrideReason === null || input.overrideReason.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The override reason is required when overriding the amount.');
  }
  return { totalSatang: input.amountOverrideSatang, overridden: true };
}

export function isDerivedBlocked(s2RowCount: number): boolean {
  return s2RowCount === 0;
}

export function canReopenReview(state: TurnoverReviewLifecycle): boolean {
  return state === 'UNRESOLVED';
}

export interface ReviewerCopyRow {
  userId: string;
  ownershipIntervalRef: string | null;
}

export function buildReviewerCopy(input: {
  s2Rows: ReviewerCopyRow[];
}): ReviewerCopyRow[] {
  if (input.s2Rows.length === 0) {
    throw new AppError('INTERNAL_ERROR', 'The turnover review has no responsible owners.');
  }
  return input.s2Rows.map((row) => ({
    userId: row.userId,
    ownershipIntervalRef: row.ownershipIntervalRef,
  }));
}
