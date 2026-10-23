'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/shared/ui';
import {
  turnoverStateLabel,
  turnoverStateVariant,
} from '@/modules/billing-payments/ui/billingLabels';

export interface TurnoverReviewCandidateWindow {
  tenancyId: string;
  startsAt: string;
  endsAt: string | null;
  state: string;
}

export interface TurnoverReviewDetailView {
  id: string;
  roomName: string;
  calendarMonth: string;
  cycleStart: string;
  state: 'UNRESOLVED' | 'RESOLVED' | 'NO_CHARGE';
  modeLabel: string;
  version: number;
  blocked: boolean;
  candidates: TurnoverReviewCandidateWindow[];
  invoiceIds: string[];
  decisionType: string | null;
  reason: string | null;
  decidedAt: string | null;
}

export function TurnoverReviewDetailCard({
  review,
  invoiceBasePath,
}: {
  review: TurnoverReviewDetailView;
  invoiceBasePath: '/invoices' | '/admin/billing/invoices';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6 rounded-xl border border-border bg-surface p-5 sm:p-7">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            data-testid="turnover-review-detail-title"
            className="break-words text-display leading-display font-semibold tracking-tight text-foreground"
          >
            {review.roomName} · {review.calendarMonth}
          </h1>
          <p className="break-all text-small leading-small text-muted-foreground">
            <span data-testid="turnover-review-detail-id">{review.id.slice(0, 8)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            data-testid="turnover-review-detail-state"
            variant={turnoverStateVariant(review.state)}
          >
            {turnoverStateLabel(review.state)}
          </Badge>
          {review.blocked ? (
            <span
              data-testid="turnover-review-detail-blocked"
              className="text-small font-medium text-danger-foreground"
            >
              Blocked
            </span>
          ) : null}
        </div>
      </div>
      <dl
        data-testid="turnover-review-detail-facts"
        className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-5 rounded-xl border border-border bg-background p-5 text-body sm:grid-cols-4"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Management</dt>
          <dd
            data-testid="turnover-review-detail-mode"
            className="break-words font-medium text-foreground"
          >
            {review.modeLabel}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Cycle start</dt>
          <dd
            data-testid="turnover-review-detail-cycle"
            className="ui-tabular break-words font-medium text-foreground"
          >
            {review.cycleStart}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Version</dt>
          <dd
            data-testid="turnover-review-detail-version"
            className="ui-tabular break-words font-medium text-foreground"
          >
            {review.version}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Invoices</dt>
          <dd
            data-testid="turnover-review-detail-invoices"
            className="ui-tabular break-words font-medium text-foreground"
          >
            {review.invoiceIds.length === 0 ? 'None' : review.invoiceIds.length}
          </dd>
        </div>
      </dl>
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="text-heading font-semibold tracking-tight text-foreground">
          Tenancies in this cycle
        </h2>
        {review.candidates.length === 0 ? (
          <p
            data-testid="turnover-review-detail-candidates-empty"
            className="text-small leading-small text-muted-foreground"
          >
            No tenancy windows are on record for this review.
          </p>
        ) : (
          <ul
            data-testid="turnover-review-detail-candidates"
            className="flex min-w-0 flex-col gap-0 divide-y divide-border rounded-lg border border-border bg-surface"
          >
            {review.candidates.map((candidate) => (
              <li key={candidate.tenancyId} className="flex min-w-0 flex-col gap-0.5 p-4 text-body">
                <span className="font-medium text-foreground">
                  {candidate.startsAt} to {candidate.endsAt ?? 'present'} · {candidate.state}
                </span>
                <span className="ui-tabular break-all text-small leading-small text-muted-foreground">
                  {candidate.tenancyId.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="text-heading font-semibold tracking-tight text-foreground">Decision</h2>
        {review.decisionType === null ? (
          <p
            data-testid="turnover-review-detail-decision"
            className="text-small leading-small text-muted-foreground"
          >
            No decision yet. This review stays in the queue until someone issues invoices or records
            no charge.
          </p>
        ) : (
          <dl
            data-testid="turnover-review-detail-decision"
            className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 rounded-lg border border-border bg-surface p-4 text-body sm:grid-cols-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Decision</dt>
              <dd className="break-words font-medium text-foreground">
                {review.decisionType === 'NO_CHARGE' ? 'No charge' : 'Issue invoices'}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Decided</dt>
              <dd className="ui-tabular break-words font-medium text-foreground">
                {review.decidedAt ?? 'Unknown'}
              </dd>
            </div>
            {review.reason !== null && review.reason !== '' ? (
              <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
                <dt className="text-small font-medium text-muted-foreground">Reason</dt>
                <dd className="break-words font-medium text-foreground">{review.reason}</dd>
              </div>
            ) : null}
          </dl>
        )}
      </div>
      {review.blocked ? (
        <p
          data-testid="turnover-review-detail-blocked-note"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          This review has no responsible owners on record, so it cannot be resolved until the
          ownership history is fixed.
        </p>
      ) : null}
      {review.invoiceIds.length > 0 ? (
        <ul
          data-testid="turnover-review-detail-invoice-list"
          className="flex min-w-0 flex-col gap-1"
        >
          {review.invoiceIds.map((invoiceId, index) => (
            <li
              key={invoiceId}
              className="ui-tabular break-all text-small leading-small text-muted-foreground"
            >
              <Link
                data-testid={`turnover-review-invoice-link-${index}`}
                href={`${invoiceBasePath}/${invoiceId}`}
                className="inline-flex items-center gap-1.5 rounded-md py-2 text-body font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                View invoice {index + 1}
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
