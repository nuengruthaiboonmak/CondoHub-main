'use client';

import { SectionCard } from '@/shared/ui';
import { useRouter } from 'next/navigation';
import {
  TurnoverResolveForm,
  type TurnoverResolveReview,
} from '@/modules/billing-payments/ui/TurnoverResolveForm';

export function TurnoverResolveSection({
  review,
  actorIsAdmin,
}: {
  review: TurnoverResolveReview;
  actorIsAdmin: boolean;
}) {
  const router = useRouter();
  return (
    <SectionCard
      title="Resolve this review"
      description="Choose how this billing cycle should be settled."
    >
      <TurnoverResolveForm
        review={review}
        actorIsAdmin={actorIsAdmin}
        onResolved={() => router.refresh()}
      />
    </SectionCard>
  );
}
