'use client';

import { WifiOff } from 'lucide-react';

export function ChatConnectionBanner({ testIdPrefix }: { testIdPrefix: string }) {
  return (
    <p
      data-testid={`${testIdPrefix}-reconnecting`}
      role="status"
      className="flex items-center justify-center gap-2 rounded-lg border border-warning-border bg-warning px-3 py-2 text-center text-xs font-medium text-warning-foreground"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      Connection lost. Reconnecting and resyncing messages.
    </p>
  );
}
