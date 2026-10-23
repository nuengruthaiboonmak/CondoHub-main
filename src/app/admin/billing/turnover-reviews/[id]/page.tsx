import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { isUuid } from '@/shared/utils/idempotency';
import { getTurnoverReview } from '@/modules/billing-payments/application/index';
import { getRentalPeriods, getRoomDetail } from '@/modules/property-membership/application/index';
import {
  TurnoverReviewDetailCard,
  type TurnoverReviewCandidateWindow,
} from '@/modules/billing-payments/ui/TurnoverReviewDetailCard';
import { TurnoverResolveSection } from '@/modules/billing-payments/ui/TurnoverResolveSection';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/billing/turnover-reviews';

function formatDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function AdminTurnoverReviewDetailPage({
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
  const review = await getTurnoverReview(actor, id);
  if (review === null) redirect(BASE_PATH);
  let roomName = review.roomId;
  try {
    const room = await getRoomDetail(review.roomId);
    roomName = room.name;
  } catch {
    roomName = review.roomId;
  }
  let candidates: TurnoverReviewCandidateWindow[] = [];
  try {
    const periods = await getRentalPeriods(review.roomId, review.calendarMonth.slice(0, 7), {
      includeCancelled: true,
    });
    const byId = new Map(periods.map((period) => [period.id, period]));
    candidates = review.candidateTenancyIds.map((tenancyId) => {
      const period = byId.get(tenancyId);
      if (period === undefined) {
        return { tenancyId, startsAt: 'Unknown', endsAt: null, state: 'Unknown' };
      }
      return {
        tenancyId,
        startsAt: formatDay(period.startsAt),
        endsAt: period.endsAt === null ? null : formatDay(period.endsAt),
        state: period.state,
      };
    });
  } catch {
    candidates = review.candidateTenancyIds.map((tenancyId) => ({
      tenancyId,
      startsAt: 'Unknown',
      endsAt: null,
      state: 'Unknown',
    }));
  }
  return (
    <main
      data-testid="turnover-review-detail-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <Link
        data-testid="turnover-review-detail-back"
        href={BASE_PATH}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to turnover reviews
      </Link>
      <TurnoverReviewDetailCard
        invoiceBasePath="/admin/billing/invoices"
        review={{
          id: review.id,
          roomName,
          calendarMonth: review.calendarMonth,
          cycleStart: review.calendarMonth,
          state: review.state,
          modeLabel:
            review.managementModeAtCreation === 'PROJECT_MANAGED' ? 'Project-managed' : 'Private',
          version: review.version,
          blocked: review.blocked,
          candidates,
          invoiceIds: review.invoiceIds,
          decisionType: review.decisionType,
          reason: review.reason,
          decidedAt: review.decidedAt === null ? null : review.decidedAt.slice(0, 10),
        }}
      />
      {review.state === 'UNRESOLVED' && !review.blocked ? (
        <TurnoverResolveSection
          review={{
            id: review.id,
            version: review.version,
            state: review.state,
            blocked: review.blocked,
            candidates: candidates
              .filter((candidate) => candidate.state !== 'CANCELLED')
              .map((candidate) => ({
                tenancyId: candidate.tenancyId,
                label: `${candidate.startsAt} to ${candidate.endsAt ?? 'present'}`,
              })),
          }}
          actorIsAdmin
        />
      ) : null}
    </main>
  );
}
