import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { getAdminJobRun } from '@/modules/billing-payments/application/index';
import { isUuid } from '@/shared/utils/idempotency';
import { JobRunDetailCard } from '@/modules/billing-payments/ui/JobRunDetailCard';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/billing/job-runs';

export default async function AdminBillingJobRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect(`/login?returnUrl=${BASE_PATH}`);
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const { id } = await params;
  if (!isUuid(id)) redirect(BASE_PATH);
  const detail = await getAdminJobRun(actor, id);
  if (detail === null) redirect(BASE_PATH);
  return (
    <main
      data-testid="job-run-detail-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <Link
        data-testid="job-run-detail-back"
        href={BASE_PATH}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to job runs
      </Link>
      <JobRunDetailCard run={detail} />
    </main>
  );
}
