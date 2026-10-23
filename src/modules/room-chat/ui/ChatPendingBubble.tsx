'use client';

import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/shared/ui';
import type { ChatOutgoingEntry } from '@/modules/room-chat/ui/chatTypes';

export function ChatPendingBubble({
  entry,
  onRetry,
  onDiscard,
  testIdPrefix,
}: {
  entry: ChatOutgoingEntry;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  testIdPrefix: string;
}) {
  const testId = `${testIdPrefix}-pending-${entry.clientMessageId}`;
  const failed = entry.status === 'failed';
  return (
    <li
      data-testid={testId}
      data-client-message-id={entry.clientMessageId}
      className="flex min-w-0 flex-col items-end gap-1.5"
    >
      <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
        <span
          data-testid={`${testId}-state`}
          role="status"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          {failed ? null : (
            <Loader2 aria-hidden="true" className="size-3 motion-safe:animate-spin" />
          )}
          {failed ? 'Not sent' : 'Sending'}
        </span>
      </div>
      <div
        className={`flex w-fit min-w-0 max-w-[85%] flex-col gap-2 rounded-2xl rounded-br-md px-4 py-3 sm:max-w-[min(75%,36rem)] ${failed ? 'border border-danger-border bg-danger text-foreground' : 'border border-dashed border-border-strong bg-surface text-foreground opacity-80'}`}
      >
        {entry.text !== null && entry.text !== '' ? (
          <p
            data-testid={`${testId}-text`}
            className="min-w-0 whitespace-pre-wrap break-words text-body leading-6"
          >
            {entry.text}
          </p>
        ) : null}
        {entry.imageId !== null ? (
          <p
            data-testid={`${testId}-image`}
            className="min-w-0 break-words text-small leading-small text-muted-foreground"
          >
            Image attached{entry.imageLabel !== null ? `: ${entry.imageLabel}` : '.'}
          </p>
        ) : null}
        {failed && entry.error !== null ? (
          <p
            data-testid={`${testId}-error`}
            role="alert"
            className="min-w-0 break-words text-body leading-6 font-medium text-danger-foreground"
          >
            {entry.error}
          </p>
        ) : null}
        {failed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-testid={`${testId}-retry`}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onRetry(entry.clientMessageId)}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Retry
            </Button>
            <Button
              data-testid={`${testId}-discard`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDiscard(entry.clientMessageId)}
            >
              Discard
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
