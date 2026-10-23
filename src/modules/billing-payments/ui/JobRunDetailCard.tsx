'use client';

import Link from 'next/link';
import { Badge, EmptyState } from '@/shared/ui';
import type { JobRunDetail } from '@/modules/billing-payments/application/index';
import { formatInstant, jobRunStateVariant } from '@/modules/billing-payments/ui/billingLabels';

export function JobRunDetailCard({ run }: { run: JobRunDetail }) {
  const result = run.result;
  return (
    <div className="flex min-w-0 flex-col gap-6 rounded-xl border border-border bg-surface p-5 sm:p-7">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            data-testid="job-run-detail-title"
            className="break-words text-display leading-display font-semibold tracking-tight text-foreground"
          >
            {run.jobName} · {run.businessKey}
          </h1>
          <p className="break-all text-small leading-small text-muted-foreground">
            <span data-testid="job-run-detail-id">{run.id}</span>
          </p>
        </div>
        <Badge data-testid="job-run-detail-state" variant={jobRunStateVariant(run.state)}>
          {run.state}
        </Badge>
      </div>
      <dl
        data-testid="job-run-detail-facts"
        className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-5 rounded-xl border border-border bg-background p-5 text-body sm:grid-cols-4"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Attempt</dt>
          <dd
            data-testid="job-run-detail-attempt"
            className="break-words font-medium text-foreground ui-tabular"
          >
            {run.attempt}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Trigger</dt>
          <dd
            data-testid="job-run-detail-trigger"
            className="break-words font-medium text-foreground"
          >
            {run.triggerSource}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Started</dt>
          <dd
            data-testid="job-run-detail-started"
            className="break-words font-medium text-foreground ui-tabular"
          >
            {formatInstant(run.startedAt)}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Finished</dt>
          <dd
            data-testid="job-run-detail-finished"
            className="break-words font-medium text-foreground ui-tabular"
          >
            {run.finishedAt === null ? 'Still running' : formatInstant(run.finishedAt)}
          </dd>
        </div>
      </dl>
      <section aria-label="Aggregate result" className="flex min-w-0 flex-col gap-3">
        <h2 className="text-heading font-semibold tracking-tight text-foreground">
          Aggregate result
        </h2>
        {result === null ? (
          <EmptyState
            data-testid="job-run-detail-no-result"
            title="Result pending"
            description="This run has not finished yet, so there is no aggregate result to show."
          />
        ) : 'transitioned' in result ? (
          <dl
            data-testid="job-run-detail-result"
            className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-border bg-surface p-4 text-body sm:grid-cols-4"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Transitioned</dt>
              <dd
                data-testid="job-run-detail-transitioned"
                className="font-medium text-foreground ui-tabular"
              >
                {result.transitioned}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Skipped young</dt>
              <dd
                data-testid="job-run-detail-skipped-young"
                className="font-medium text-foreground ui-tabular"
              >
                {result.skippedYoung}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Objects deleted</dt>
              <dd
                data-testid="job-run-detail-s3-deleted"
                className="font-medium text-foreground ui-tabular"
              >
                {result.s3Deleted}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Caught up</dt>
              <dd data-testid="job-run-detail-caught-up" className="font-medium text-foreground">
                {result.caughtUp ? 'Yes' : 'No'}
              </dd>
            </div>
          </dl>
        ) : (
          <dl
            data-testid="job-run-detail-result"
            className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-border bg-surface p-4 text-body sm:grid-cols-4"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Created</dt>
              <dd
                data-testid="job-run-detail-created"
                className="font-medium text-foreground ui-tabular"
              >
                {result.created}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Skipped</dt>
              <dd
                data-testid="job-run-detail-skipped"
                className="font-medium text-foreground ui-tabular"
              >
                {result.skipped}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Review</dt>
              <dd
                data-testid="job-run-detail-review"
                className="font-medium text-foreground ui-tabular"
              >
                {result.reviewRequired}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Caught up</dt>
              <dd data-testid="job-run-detail-caught-up" className="font-medium text-foreground">
                {result.caughtUp ? 'Yes' : 'No'}
              </dd>
            </div>
          </dl>
        )}
        {result !== null && 'nextFromCycle' in result && result.nextFromCycle !== undefined ? (
          <p className="text-small leading-small text-muted-foreground">
            Next window starts at{' '}
            <span data-testid="job-run-detail-next">{result.nextFromCycle}</span>.
          </p>
        ) : null}
      </section>
      {run.state === 'ERROR' ? (
        <p
          data-testid="job-run-detail-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {run.errorMessage ?? `Failed with code ${run.errorCode ?? 'UNKNOWN'}.`}
        </p>
      ) : null}
      {run.jobName === 'generate-invoices' ? (
        <Link
          data-testid="job-run-detail-invoices"
          href="/admin/billing/invoices"
          className="rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Review generated invoices
        </Link>
      ) : null}
    </div>
  );
}
