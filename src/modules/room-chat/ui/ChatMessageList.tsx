'use client';

import { Fragment } from 'react';
import { ChatMessageBubble } from '@/modules/room-chat/ui/ChatMessageBubble';
import { ChatPendingBubble } from '@/modules/room-chat/ui/ChatPendingBubble';
import { chatDayKey } from '@/modules/room-chat/ui/chatLabels';
import type { ChatMessageDto, ChatOutgoingEntry } from '@/modules/room-chat/ui/chatTypes';

export function ChatMessageList({
  messages,
  outgoing,
  actorUserId,
  testIdPrefix,
  onRetry,
  onDiscard,
}: {
  messages: ChatMessageDto[];
  outgoing: ChatOutgoingEntry[];
  actorUserId: string;
  testIdPrefix: string;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}) {
  let lastDay = '';
  return (
    <ul data-testid={`${testIdPrefix}-list`} className="flex min-w-0 flex-col gap-5">
      {messages.map((message) => {
        const day = chatDayKey(message.createdAt);
        const showSeparator = day !== lastDay;
        lastDay = day;
        return (
          <Fragment key={message.id}>
            <ChatMessageBubble
              message={message}
              own={message.senderUserId === actorUserId}
              testIdPrefix={testIdPrefix}
              separator={showSeparator ? { value: message.createdAt, day } : null}
            />
          </Fragment>
        );
      })}
      {outgoing.map((entry) => (
        <ChatPendingBubble
          key={entry.clientMessageId}
          entry={entry}
          onRetry={onRetry}
          onDiscard={onDiscard}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </ul>
  );
}
