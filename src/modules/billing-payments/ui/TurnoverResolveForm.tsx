'use client';

import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, useToast } from '@/shared/ui';
import { CHECKBOX_CLASS, INPUT_CLASS } from '@/shared/ui';
import {
  PER_INVOICE_FIELD_IDS,
  turnoverResolveFormSchema,
  type TurnoverResolveFormValues,
} from '@/modules/billing-payments/ui/turnoverResolveFormSchema';

export interface TurnoverResolveCandidate {
  tenancyId: string;
  label: string;
}

export interface TurnoverResolveReview {
  id: string;
  version: number;
  state: 'UNRESOLVED' | 'RESOLVED' | 'NO_CHARGE';
  blocked: boolean;
  candidates: TurnoverResolveCandidate[];
}

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

interface ResolvePayload {
  data?: { state?: string; version?: number };
}

function projectToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isPastDate(dueDate: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return false;
  return dueDate < today;
}

export function TurnoverResolveForm({
  review,
  actorIsAdmin,
  onResolved,
}: {
  review: TurnoverResolveReview;
  actorIsAdmin: boolean;
  onResolved: (state: 'RESOLVED' | 'NO_CHARGE') => void;
}) {
  const { toast } = useToast();
  const today = useMemo(() => projectToday(), []);
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pastRejected, setPastRejected] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    setFocus,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TurnoverResolveFormValues>({
    resolver: zodResolver(turnoverResolveFormSchema),
    defaultValues: {
      decision: 'ISSUE_INVOICES',
      selectedTenancyIds: [],
      perInvoice: [],
      noChargeReason: '',
      expectedVersion: review.version,
    },
  });
  const decision = watch('decision');
  const selected = watch('selectedTenancyIds');
  const perInvoice = watch('perInvoice');

  const toggleTenancy = (tenancyId: string, checked: boolean): void => {
    if (checked) {
      setValue(
        'selectedTenancyIds',
        [...(selected as string[]), tenancyId] as never,
        { shouldValidate: true },
      );
      setValue(
        'perInvoice',
        [...(perInvoice as TurnoverResolveFormValues extends { perInvoice: infer P } ? P : never[]), { tenancyId, dueDate: '' }] as never,
        { shouldValidate: true },
      );
      return;
    }
    setValue(
      'selectedTenancyIds',
      (selected as string[]).filter((id) => id !== tenancyId) as never,
      { shouldValidate: true },
    );
    setValue(
      'perInvoice',
      (perInvoice as { tenancyId: string }[]).filter((entry) => entry.tenancyId !== tenancyId) as never,
      { shouldValidate: true },
    );
  };

  const focusFirstInvalid = (invalid: typeof errors): void => {
    if (decision === 'NO_CHARGE') {
      setFocus('noChargeReason');
      return;
    }
    const issueErrors = invalid as {
      perInvoice?: Array<{ dueDate?: unknown; overrideReason?: unknown } | undefined>;
      selectedTenancyIds?: unknown;
    };
    const entries = issueErrors.perInvoice ?? [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry?.dueDate !== undefined) {
        const tenancyId = (perInvoice as { tenancyId: string }[])[index]?.tenancyId;
        if (tenancyId !== undefined) {
          document.getElementById(PER_INVOICE_FIELD_IDS.dueDate(tenancyId))?.focus();
          return;
        }
      }
      if (entry?.overrideReason !== undefined) {
        const tenancyId = (perInvoice as { tenancyId: string }[])[index]?.tenancyId;
        if (tenancyId !== undefined) {
          document.getElementById(PER_INVOICE_FIELD_IDS.overrideReason(tenancyId))?.focus();
          return;
        }
      }
    }
    if (issueErrors.selectedTenancyIds !== undefined && review.candidates.length > 0) {
      document.getElementById(PER_INVOICE_FIELD_IDS.checkbox(review.candidates[0]?.tenancyId ?? ''))?.focus();
    }
  };

  const onSubmit = handleSubmit(
    async (values) => {
      setServerError(null);
      setConflict(false);
      setPastRejected(false);
      const body =
        values.decision === 'NO_CHARGE'
          ? {
              decision: 'NO_CHARGE' as const,
              selectedTenancyIds: [],
              reason: values.noChargeReason.trim(),
              expectedVersion: review.version,
            }
          : {
              decision: 'ISSUE_INVOICES' as const,
              selectedTenancyIds: values.selectedTenancyIds,
              perInvoice: values.perInvoice.map((entry) => {
                const override = (entry.amountOverride ?? '').trim();
                const reason = (entry.overrideReason ?? '').trim();
                return {
                  tenancyId: entry.tenancyId,
                  dueDate: entry.dueDate,
                  ...(entry.confirmPastDueDate === true ? { confirmPastDueDate: true } : {}),
                  ...(override === '' || !actorIsAdmin
                    ? {}
                    : {
                        amountOverride: { amount: override, currency: 'THB' as const },
                        overrideReason: reason,
                      }),
                };
              }),
              expectedVersion: review.version,
            };
      const response = await fetch(`/api/billing/turnover-reviews/${review.id}/resolve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        const code = payload?.error?.code;
        if (code === 'VERSION_CONFLICT') setConflict(true);
        if (code === 'PAST_DUE_DATE_CONFIRMATION_REQUIRED') setPastRejected(true);
        if (response.status === 401 || response.status === 403) {
          setServerError('Your session cannot resolve this turnover review.');
          return;
        }
        setServerError(payload?.error?.message ?? 'Could not resolve the turnover review.');
        return;
      }
      const payload = (await response.json().catch(() => null)) as ResolvePayload | null;
      const state = payload?.data?.state;
      if (state !== 'RESOLVED' && state !== 'NO_CHARGE') {
        setServerError('The review was resolved but the response was empty. Reload the page.');
        return;
      }
      toast.success(state === 'RESOLVED' ? 'Invoices issued.' : 'No charge recorded.');
      onResolved(state);
    },
    (invalid) => {
      focusFirstInvalid(invalid);
    },
  );

  if (review.state !== 'UNRESOLVED' || review.blocked) return null;

  const selectedSet = new Set(selected as string[]);
  const entries = perInvoice as {
    tenancyId: string;
    dueDate: string;
    confirmPastDueDate?: boolean;
  }[];

  return (
    <form data-testid="turnover-resolve-form" onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-5">
      {serverError !== null ? (
        <p data-testid="turnover-resolve-error" role="alert" className="text-body leading-body font-medium text-danger-foreground">
          {serverError}
        </p>
      ) : null}
      {conflict ? (
        <p data-testid="turnover-resolve-conflict" role="alert" className="text-body leading-body font-medium text-danger-foreground">
          Someone resolved this review first. Reload the page to see the latest state.
        </p>
      ) : null}
      {pastRejected ? (
        <p data-testid="turnover-resolve-past-rejected" role="alert" className="text-body leading-body font-medium text-danger-foreground">
          A backdated due date needs an explicit confirmation per invoice before submitting.
        </p>
      ) : null}
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-body font-semibold text-foreground">Decision</legend>
        <Controller
          control={control}
          name="decision"
          render={({ field }) => (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-surface p-3 text-body transition-[border-color] duration-150 ease-out hover:border-border-strong motion-reduce:transition-none">
                <input
                  data-testid="turnover-resolve-decision-issue"
                  type="radio"
                  value="ISSUE_INVOICES"
                  checked={field.value === 'ISSUE_INVOICES'}
                  onChange={() => field.onChange('ISSUE_INVOICES')}
                  className={`${CHECKBOX_CLASS} mt-1`}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium text-foreground">Issue invoices</span>
                  <span className="text-small leading-small text-muted-foreground">
                    Bill at least one tenancy in this review. Each invoice needs its own due date.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-surface p-3 text-body transition-[border-color] duration-150 ease-out hover:border-border-strong motion-reduce:transition-none">
                <input
                  data-testid="turnover-resolve-decision-no-charge"
                  type="radio"
                  value="NO_CHARGE"
                  checked={field.value === 'NO_CHARGE'}
                  onChange={() => {
                    field.onChange('NO_CHARGE');
                    setValue('selectedTenancyIds', [] as never);
                    setValue('perInvoice', [] as never);
                  }}
                  className={`${CHECKBOX_CLASS} mt-1`}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium text-foreground">No charge</span>
                  <span className="text-small leading-small text-muted-foreground">
                    Waive rent for every tenancy in this cycle, with a reason. No invoices are
                    created and the job will not bill this cycle later.
                  </span>
                </span>
              </label>
            </div>
          )}
        />
      </fieldset>
      {decision === 'ISSUE_INVOICES' ? (
        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="text-body font-semibold text-foreground">Tenancies to bill</h2>
          {(errors as { selectedTenancyIds?: { message?: string } }).selectedTenancyIds !== undefined ? (
            <p data-testid="turnover-resolve-selection-error" role="alert" className="text-body leading-body font-medium text-danger-foreground">
              {(errors as { selectedTenancyIds?: { message?: string } }).selectedTenancyIds?.message}
            </p>
          ) : null}
          <ul className="flex min-w-0 flex-col gap-0 divide-y divide-border rounded-lg border border-border bg-surface">
            {review.candidates.map((candidate) => {
              const checked = selectedSet.has(candidate.tenancyId);
              const entryIndex = entries.findIndex((entry) => entry.tenancyId === candidate.tenancyId);
              const dueDate = entryIndex >= 0 ? (entries[entryIndex]?.dueDate ?? '') : '';
              const past = checked && isPastDate(dueDate, today);
              const entryErrors = (
                errors as {
                  perInvoice?: Array<{
                    dueDate?: { message?: string };
                    overrideReason?: { message?: string };
                    amountOverride?: { message?: string };
                  }>;
                }
              ).perInvoice?.[entryIndex];
              return (
                <li
                  key={candidate.tenancyId}
                  className="flex min-w-0 flex-col gap-3 p-4"
                >
                  <label className="flex cursor-pointer items-start gap-2 text-body">
                    <input
                      id={PER_INVOICE_FIELD_IDS.checkbox(candidate.tenancyId)}
                      data-testid={`turnover-resolve-select-${candidate.tenancyId}`}
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => toggleTenancy(candidate.tenancyId, event.target.checked)}
                      className={`${CHECKBOX_CLASS} mt-1`}
                    />
                    <span className="min-w-0 break-words font-medium text-foreground">
                      {candidate.label}
                    </span>
                  </label>
                  {checked && entryIndex >= 0 ? (
                    <div className="flex min-w-0 flex-col gap-3 pl-6">
                      <div className="flex min-w-0 max-w-xs flex-col gap-1.5">
                        <label htmlFor={PER_INVOICE_FIELD_IDS.dueDate(candidate.tenancyId)} className="text-body font-medium text-foreground">
                          Due date
                        </label>
                        <input
                          id={PER_INVOICE_FIELD_IDS.dueDate(candidate.tenancyId)}
                          data-testid={`turnover-resolve-due-${candidate.tenancyId}`}
                          type="date"
                          aria-invalid={entryErrors?.dueDate !== undefined}
                          aria-describedby={
                            entryErrors?.dueDate !== undefined
                              ? PER_INVOICE_FIELD_IDS.dueDateError(candidate.tenancyId)
                              : undefined
                          }
                          className={INPUT_CLASS}
                          {...register(`perInvoice.${entryIndex}.dueDate` as never)}
                        />
                        {entryErrors?.dueDate !== undefined ? (
                          <p id={PER_INVOICE_FIELD_IDS.dueDateError(candidate.tenancyId)} role="alert" className="text-body leading-body font-medium text-danger-foreground">
                            {entryErrors.dueDate.message}
                          </p>
                        ) : null}
                      </div>
                      {past ? (
                        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-warning-border bg-warning p-3">
                          <p data-testid={`turnover-resolve-past-warning-${candidate.tenancyId}`} role="alert" className="text-body leading-body text-warning-foreground">
                            This due date is before today. If the balance stays unpaid, the invoice
                            becomes overdue right after it is issued. Confirming only acknowledges
                            the date, not a payment.
                          </p>
                          <label className="flex cursor-pointer items-start gap-2 text-body">
                            <input
                              id={PER_INVOICE_FIELD_IDS.confirm(candidate.tenancyId)}
                              data-testid={`turnover-resolve-confirm-${candidate.tenancyId}`}
                              type="checkbox"
                              className={`${CHECKBOX_CLASS} mt-1`}
                              {...register(`perInvoice.${entryIndex}.confirmPastDueDate` as never)}
                            />
                            <span className="min-w-0 leading-6 text-warning-foreground">
                              I confirm this backdated due date for this invoice.
                            </span>
                          </label>
                        </div>
                      ) : null}
                      {actorIsAdmin ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="flex min-w-0 flex-col gap-1.5">
                            <label htmlFor={PER_INVOICE_FIELD_IDS.override(candidate.tenancyId)} className="text-body font-medium text-foreground">
                              Amount override (THB, optional)
                            </label>
                            <input
                              id={PER_INVOICE_FIELD_IDS.override(candidate.tenancyId)}
                              data-testid={`turnover-resolve-override-${candidate.tenancyId}`}
                              type="text"
                              inputMode="decimal"
                              placeholder="3000.00"
                              aria-invalid={entryErrors?.amountOverride !== undefined}
                              aria-describedby={
                                entryErrors?.amountOverride !== undefined
                                  ? PER_INVOICE_FIELD_IDS.overrideError(candidate.tenancyId)
                                  : undefined
                              }
                              className={INPUT_CLASS}
                              {...register(`perInvoice.${entryIndex}.amountOverride` as never)}
                            />
                            {entryErrors?.amountOverride !== undefined ? (
                              <p id={PER_INVOICE_FIELD_IDS.overrideError(candidate.tenancyId)} role="alert" className="text-body leading-body font-medium text-danger-foreground">
                                {entryErrors.amountOverride.message}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex min-w-0 flex-col gap-1.5">
                            <label htmlFor={PER_INVOICE_FIELD_IDS.overrideReason(candidate.tenancyId)} className="text-body font-medium text-foreground">
                              Override reason
                            </label>
                            <input
                              id={PER_INVOICE_FIELD_IDS.overrideReason(candidate.tenancyId)}
                              data-testid={`turnover-resolve-override-reason-${candidate.tenancyId}`}
                              type="text"
                              maxLength={500}
                              aria-invalid={entryErrors?.overrideReason !== undefined}
                              aria-describedby={
                                entryErrors?.overrideReason !== undefined
                                  ? PER_INVOICE_FIELD_IDS.overrideReasonError(candidate.tenancyId)
                                  : undefined
                              }
                              className={INPUT_CLASS}
                              {...register(`perInvoice.${entryIndex}.overrideReason` as never)}
                            />
                            {entryErrors?.overrideReason !== undefined ? (
                              <p id={PER_INVOICE_FIELD_IDS.overrideReasonError(candidate.tenancyId)} role="alert" className="text-body leading-body font-medium text-danger-foreground">
                                {entryErrors.overrideReason.message}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="turnover-resolve-no-charge-reason" className="text-body font-medium text-foreground">
            No-charge reason
          </label>
          <input
            id="turnover-resolve-no-charge-reason"
            data-testid="turnover-resolve-no-charge-reason"
            type="text"
            maxLength={500}
            aria-invalid={(errors as { noChargeReason?: unknown }).noChargeReason !== undefined}
            aria-describedby={
              (errors as { noChargeReason?: unknown }).noChargeReason !== undefined
                ? 'turnover-resolve-no-charge-reason-error'
                : undefined
            }
            className={INPUT_CLASS}
            {...register('noChargeReason' as never)}
          />
          {(errors as { noChargeReason?: { message?: string } }).noChargeReason !== undefined ? (
            <p id="turnover-resolve-no-charge-reason-error" role="alert" className="text-body leading-body font-medium text-danger-foreground">
              {(errors as { noChargeReason?: { message?: string } }).noChargeReason?.message}
            </p>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button data-testid="turnover-resolve-submit" type="submit" loading={isSubmitting}>
          {decision === 'NO_CHARGE' ? 'Record no charge' : 'Issue invoices'}
        </Button>
      </div>
    </form>
  );
}
