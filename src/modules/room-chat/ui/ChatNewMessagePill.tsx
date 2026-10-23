'use client';

import { ArrowDown } from 'lucide-react';
import { Button } from '@/shared/ui';

export function ChatNewMessagePill({
  count,
  onJump,
  testIdPrefix,
}: {
  count: number;
  onJump: () => void;
  testIdPrefix: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
      <Button
        data-testid={`${testIdPrefix}-new-pill`}
        type="button"
        variant="primary"
        size="sm"
        onClick={onJump}
        className="pointer-events-auto rounded-full shadow-overlay"
      >
        <ArrowDown aria-hidden="true" className="size-4" />
        {count === 1 ? 'New message' : `${count} new messages`}
      </Button>
    </div>
  );
}
