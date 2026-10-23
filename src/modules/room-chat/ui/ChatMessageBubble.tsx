'use client';

import { Badge } from '@/shared/ui';
import { ChatDateSeparator } from '@/modules/room-chat/ui/ChatDateSeparator';
import { ChatImageBubble } from '@/modules/room-chat/ui/ChatImageBubble';
import { formatChatExact, formatChatTime } from '@/modules/room-chat/ui/chatLabels';
import type { ChatMessageDto } from '@/modules/room-chat/ui/chatTypes';

export function ChatMessageBubble({
  message,
  own,
  testIdPrefix,
  separator,
}: {
  message: ChatMessageDto;
  own: boolean;
  testIdPrefix: string;
  separator: { value: string; day: string } | null;
}) {
  const testId = `${testIdPrefix}-message-${message.id}`;
  return (
    <li
      data-testid={testId}
      data-message-id={message.id}
      data-created-at={message.createdAt}
      className={`flex min-w-0 flex-col gap-1.5 ${own ? 'items-end' : 'items-start'}`}
    >
      {separator !== null ? (
        <div className="w-full min-w-0" data-chat-separator="true">
          <ChatDateSeparator
            value={separator.value}
            testId={`${testIdPrefix}-day-${separator.day}`}
          />
        </div>
      ) : null}
      <div
        className={`flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 ${own ? 'justify-end' : 'justify-start'}`}
      >
        <span
          data-testid={`${testId}-sender`}
          className="min-w-0 break-words text-xs font-medium text-body-secondary"
        >
          {message.senderName}
        </span>
        {message.senderIsAdmin ? (
          <Badge data-testid={`${testId}-admin`} variant="info">
            Admin
            <span className="sr-only">message from a system admin</span>
          </Badge>
        ) : null}
        <time
          data-testid={`${testId}-time`}
          dateTime={message.createdAt}
          title={formatChatExact(message.createdAt)}
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {formatChatTime(message.createdAt)}
        </time>
      </div>
      <div
        className={`flex w-fit min-w-0 max-w-[85%] flex-col gap-2 rounded-2xl px-4 py-3 sm:max-w-[min(75%,36rem)] ${
          own
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md border border-border bg-surface-raised text-foreground shadow-raised'
        }`}
      >
        {message.text !== null && message.text !== '' ? (
          <p
            data-testid={`${testId}-text`}
            className="min-w-0 whitespace-pre-wrap break-words text-body leading-6"
          >
            {message.text}
          </p>
        ) : null}
        {message.imageId !== null ? (
          <ChatImageBubble
            imageId={message.imageId}
            alt="Chat image attachment"
            testId={`${testId}-image`}
          />
        ) : null}
      </div>
    </li>
  );
}
