'use client';

import type { InvoiceDto } from '@/modules/billing-payments/application/index';
import { formatInstant, kindLabel } from '@/modules/billing-payments/ui/billingLabels';

export function InvoiceDetailCard({
  invoice,
  roomLabel,
  tenancyLabel,
}: {
  invoice: InvoiceDto;
  roomLabel?: string | undefined;
  tenancyLabel?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6 rounded-xl border border-border bg-surface p-5 sm:p-7">
      <div className="flex min-w-0 flex-col gap-1">
        <h1
          data-testid="invoice-detail-title"
          className="break-words text-display leading-display font-semibold tracking-tight text-foreground"
        >
          {kindLabel(invoice.kind)} · {invoice.periodStart}
        </h1>
        <p className="mt-1 break-words text-body text-muted-foreground">
          {roomLabel ?? 'Room unavailable'}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-background p-5">
        <p className="text-small font-medium text-muted-foreground">Outstanding</p>
        <p
          data-testid="invoice-payment-outstanding"
          className="ui-tabular break-words text-display font-semibold tracking-tight text-foreground"
        >
          {invoice.outstanding.amount} {invoice.outstanding.currency}
        </p>
      </div>
      <dl
        data-testid="invoice-detail-facts"
        className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 border-t border-border pt-5 text-body sm:grid-cols-3"
      >
        {tenancyLabel ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-small font-medium text-muted-foreground">Rental period</dt>
            <dd
              data-testid="invoice-detail-tenancy"
              className="break-words font-medium text-foreground ui-tabular"
            >
              {tenancyLabel}
            </dd>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Total</dt>
          <dd
            data-testid="invoice-detail-total"
            className="ui-tabular break-words font-medium text-foreground"
          >
            {invoice.total.amount} {invoice.total.currency}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Due date</dt>
          <dd
            data-testid="invoice-detail-due"
            className="ui-tabular break-words font-medium text-foreground"
          >
            {invoice.dueDate}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Period</dt>
          <dd
            data-testid="invoice-detail-period"
            className="ui-tabular break-words font-medium text-foreground"
          >
            {invoice.periodStart} to {invoice.periodEnd}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-small font-medium text-muted-foreground">Issued</dt>
          <dd
            data-testid="invoice-detail-issued"
            className="ui-tabular break-words font-medium text-foreground"
          >
            {invoice.issuedAt === null ? 'Not issued yet' : formatInstant(invoice.issuedAt)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
