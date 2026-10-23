'use client';

import { Button, EmptyState } from '@/shared/ui';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-[var(--ui-content-wide)] px-4 py-12 sm:px-6">
      <EmptyState
        title="This page could not be loaded"
        description="Your connection or the service may be temporarily unavailable. Try loading the page again."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </main>
  );
}
