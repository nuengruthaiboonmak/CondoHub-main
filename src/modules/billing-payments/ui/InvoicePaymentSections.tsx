'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, FormDialog, SectionCard } from '@/shared/ui';
import type {
  InvoiceDto,
  InvoiceRevisionDto,
  PaymentInstructionDto,
  PaymentSubmissionDto,
} from '@/modules/billing-payments/application/index';
import { PaymentImage } from '@/modules/billing-payments/ui/PaymentImage';
import { PaymentSubmissionCard } from '@/modules/billing-payments/ui/PaymentSubmissionCard';
import { PaymentSubmitForm } from '@/modules/billing-payments/ui/PaymentSubmitForm';
import { InvoiceEditForm } from '@/modules/billing-payments/ui/InvoiceEditForm';
import {
  formatInstant,
  invoiceStateLabel,
  invoiceStateVariant,
} from '@/modules/billing-payments/ui/billingLabels';

export function InvoicePaymentSections({
  invoice,
  submissions,
  revisions,
  instruction,
  actorIsAdmin,
  permissions,
}: {
  invoice: InvoiceDto;
  submissions: PaymentSubmissionDto[];
  revisions: InvoiceRevisionDto[];
  instruction: PaymentInstructionDto | null;
  actorIsAdmin: boolean;
  permissions: {
    canEdit: boolean;
    canApprove: boolean;
    canReject: boolean;
    canSubmit: boolean;
    receivesRent: boolean;
  };
}) {
  const router = useRouter();
  const refresh = (): void => router.refresh();
  const pendingSubmissions = submissions.filter((submission) => submission.state === 'PENDING');
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-6 xl:grid-cols-2">
        <SectionCard
          title="Balance"
          action={
            permissions.canEdit ? (
              <FormDialog
                icon="edit"
                triggerLabel="Edit invoice total"
                title="Edit invoice total"
                description="Changes are recorded in the invoice history."
                triggerTestId="invoice-edit-open"
                testId="invoice-edit-dialog"
                variant="secondary"
              >
                <InvoiceEditForm
                  invoiceId={invoice.id}
                  version={invoice.version}
                  currentTotal={invoice.total.amount}
                  onEdited={refresh}
                />
              </FormDialog>
            ) : null
          }
        >
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Badge data-testid="invoice-payment-state" variant={invoiceStateVariant(invoice.state)}>
              {invoiceStateLabel(invoice.state)}
            </Badge>
            {invoice.overdue ? (
              <span className="text-small font-medium text-danger-foreground">Overdue</span>
            ) : null}
          </div>
          {invoice.pendingOnPaid ? (
            <p
              data-testid="invoice-payment-pending-on-paid"
              role="alert"
              className="rounded-md border border-warning-border bg-warning p-3 text-small leading-small text-warning-foreground"
            >
              This invoice is already paid, but payment slips are still awaiting review. Reject the
              pending slips so the queue stays accurate.
            </p>
          ) : null}
          <dl
            data-testid="invoice-payment-facts"
            className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 border-t border-border pt-5 text-body sm:grid-cols-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Approved</dt>
              <dd
                data-testid="invoice-payment-approved"
                className="ui-tabular break-words font-medium text-foreground"
              >
                {invoice.approvedTotal.amount} {invoice.approvedTotal.currency}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-small font-medium text-muted-foreground">Pending slips</dt>
              <dd
                data-testid="invoice-payment-pending-count"
                className="ui-tabular break-words font-medium text-foreground"
              >
                {pendingSubmissions.length}
              </dd>
            </div>
          </dl>
        </SectionCard>
        {instruction !== null && instruction.accountNumber !== 'SYSTEM-AUTO' ? (
          <SectionCard
            title={permissions.receivesRent ? 'Receiving account' : 'How to pay'}
            description={
              permissions.receivesRent
                ? 'The account shared with tenants on this invoice.'
                : 'Use these payment details when transferring funds.'
            }
          >
            <dl
              data-testid="invoice-payment-instruction"
              className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 rounded-lg border border-border bg-background p-4 text-body sm:grid-cols-2"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-small font-medium text-muted-foreground">Bank</dt>
                <dd
                  data-testid="invoice-payment-bank"
                  className="break-words font-medium text-foreground"
                >
                  {instruction.bankName}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-small font-medium text-muted-foreground">Account name</dt>
                <dd
                  data-testid="invoice-payment-account-name"
                  className="break-words font-medium text-foreground"
                >
                  {instruction.accountName}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-small font-medium text-muted-foreground">Account number</dt>
                <dd
                  data-testid="invoice-payment-account-number"
                  className="ui-tabular break-words font-medium text-foreground"
                >
                  {instruction.accountNumber}
                </dd>
              </div>
            </dl>
            {instruction.qrImageId !== null ? (
              <PaymentImage
                imageId={instruction.qrImageId}
                alt="Payment QR code"
                testId="invoice-payment-qr"
              />
            ) : null}
          </SectionCard>
        ) : (
          <SectionCard title={permissions.receivesRent ? 'Receiving account' : 'How to pay'}>
            <p className="text-body leading-relaxed text-muted-foreground">
              Payment details have not been configured for this invoice. Contact the receiving party
              before transferring funds.
            </p>
            {actorIsAdmin ? (
              <Link
                href={'/admin/billing/settings'}
                className="mt-4 inline-flex text-body font-medium text-link hover:underline"
              >
                Configure payment details
              </Link>
            ) : null}
          </SectionCard>
        )}
      </div>
      <SectionCard
        title="Payment slips"
        description="Submitted payments and their review status."
        action={
          !actorIsAdmin && permissions.canSubmit ? (
            <FormDialog
              triggerLabel={
                permissions.receivesRent ? 'Record payment slip' : 'Submit payment slip'
              }
              title={permissions.receivesRent ? 'Record payment slip' : 'Submit payment slip'}
              triggerTestId="payment-submit-open"
              testId="payment-submit-dialog"
            >
              <PaymentSubmitForm invoiceId={invoice.id} onSubmitted={refresh} />
            </FormDialog>
          ) : null
        }
      >
        {submissions.length === 0 ? (
          <p
            data-testid="invoice-payment-submissions-empty"
            className="text-small leading-small text-muted-foreground"
          >
            No payment slips yet.
          </p>
        ) : (
          <ul data-testid="invoice-payment-submissions" className="flex min-w-0 flex-col gap-3">
            {submissions.map((submission) => (
              <PaymentSubmissionCard
                key={submission.id}
                submission={submission}
                outstanding={invoice.outstanding.amount}
                approveBlocked={!permissions.canApprove}
                canReview={permissions.canApprove || permissions.canReject}
                onReviewed={refresh}
              />
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Total history" description="Changes to the amount of this invoice.">
        {revisions.length === 0 ? (
          <p
            data-testid="invoice-payment-revisions-empty"
            className="text-small leading-small text-muted-foreground"
          >
            The total has not changed since this invoice was issued.
          </p>
        ) : (
          <ul data-testid="invoice-payment-revisions" className="flex min-w-0 flex-col gap-3">
            {revisions.map((revision) => (
              <li
                key={revision.id}
                data-testid={`invoice-payment-revision-${revision.id}`}
                className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-body"
              >
                <p className="ui-tabular break-words font-medium text-foreground">
                  {revision.oldTotal.amount} {revision.oldTotal.currency} to{' '}
                  {revision.newTotal.amount} {revision.newTotal.currency}
                </p>
                {revision.reason !== null && revision.reason !== '' ? (
                  <p className="break-words leading-body text-foreground">{revision.reason}</p>
                ) : null}
                <p className="ui-tabular break-all text-small leading-small text-muted-foreground">
                  {formatInstant(revision.changedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
