'use client';

import { formatChatDay } from '@/modules/room-chat/ui/chatLabels';

export function ChatDateSeparator({ value, testId }: { value: string; testId: string }) {
  return (
    <div data-testid={testId} className="flex items-center gap-3 py-3" role="separator">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium tabular-nums text-neutral-foreground">
        {formatChatDay(value)}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
