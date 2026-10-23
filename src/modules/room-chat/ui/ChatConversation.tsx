'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, History, Loader2 } from 'lucide-react';
import { EmptyState, useToast } from '@/shared/ui';
import { ChatComposer, type ChatComposerAttachment } from '@/modules/room-chat/ui/ChatComposer';
import { ChatConnectionBanner } from '@/modules/room-chat/ui/ChatConnectionBanner';
import { ChatMessageList } from '@/modules/room-chat/ui/ChatMessageList';
import { ChatNewMessagePill } from '@/modules/room-chat/ui/ChatNewMessagePill';
import { CHAT_PAGE_SIZE, chatSendErrorCopy } from '@/modules/room-chat/ui/chatLabels';
import type {
  ChatErrorEnvelope,
  ChatListEnvelope,
  ChatMessageDto,
  ChatOutgoingEntry,
  ChatSendEnvelope,
} from '@/modules/room-chat/ui/chatTypes';
import { useChatSocket, type ChatSocketSignal } from '@/modules/room-chat/ui/useChatSocket';

const BOTTOM_THRESHOLD_PX = 48;

function comparePosition(a: ChatMessageDto, b: ChatMessageDto): number {
  const time = a.createdAt.localeCompare(b.createdAt);
  if (time !== 0) return time;
  return a.id.localeCompare(b.id);
}

function mergeMessages(current: ChatMessageDto[], incoming: ChatMessageDto[]): ChatMessageDto[] {
  const seen = new Map<string, ChatMessageDto>();
  for (const message of current) seen.set(message.id, message);
  for (const message of incoming) seen.set(message.id, message);
  return [...seen.values()].sort(comparePosition);
}

function positionOf(message: ChatMessageDto): { createdAt: string; id: string } {
  return { createdAt: message.createdAt, id: message.id };
}

function encodeAfterCursor(message: ChatMessageDto): string {
  const raw = JSON.stringify(positionOf(message));
  const latin = Array.from(new TextEncoder().encode(raw))
    .map((code) => String.fromCharCode(code))
    .join('');
  return btoa(latin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function ChatConversation({
  roomId,
  roomLabel,
  actorUserId,
  initialMessages,
  initialCursor,
  backHref,
  backLabel,
  testIdPrefix,
}: {
  roomId: string;
  roomLabel: string;
  actorUserId: string;
  initialMessages: ChatMessageDto[];
  initialCursor: string | null;
  backHref: string;
  backLabel: string;
  testIdPrefix: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessageDto[]>(initialMessages);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [outgoing, setOutgoing] = useState<ChatOutgoingEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const [historyChecked, setHistoryChecked] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef(true);
  const revokedRef = useRef(false);
  const atBottomRef = useRef(true);
  const messagesRef = useRef(initialMessages);
  messagesRef.current = messages;
  const restoreRef = useRef<{ key: string; offset: number } | null>(null);

  function isNearBottom(): boolean {
    const node = scrollRef.current;
    if (node === null) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_THRESHOLD_PX;
  }

  function scrollToBottom(): void {
    const node = scrollRef.current;
    if (node === null) return;
    node.scrollTop = node.scrollHeight;
  }

  function markSeen(): void {
    setUnseen(0);
  }

  const handleRevoked = useCallback(() => {
    if (revokedRef.current) return;
    revokedRef.current = true;
    setRevoked(true);
    toast.warning('Chat access ended.', {
      description: 'You no longer have access to this room. Returning to Rooms.',
    });
    window.setTimeout(() => {
      router.push('/rooms');
      router.refresh();
    }, 1200);
  }, [router, toast]);

  const resyncAfterReconnect = useCallback(async () => {
    const latest = messagesRef.current[messagesRef.current.length - 1];
    const query =
      latest === undefined
        ? `?limit=${CHAT_PAGE_SIZE}`
        : `?after=${encodeURIComponent(encodeAfterCursor(latest))}&limit=${CHAT_PAGE_SIZE}`;
    try {
      const response = await fetch(`/api/rooms/${roomId}/messages${query}`);
      if (!liveRef.current || revokedRef.current) return;
      if (response.status === 404 || response.status === 403) {
        handleRevoked();
        return;
      }
      if (!response.ok) return;
      const envelope = (await response.json()) as ChatListEnvelope;
      if (envelope.data.length === 0) return;
      setMessages((current) => mergeMessages(current, envelope.data));
      if (atBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom());
      } else {
        setUnseen((count) => count + envelope.data.length);
      }
    } catch {
      return;
    }
  }, [handleRevoked, roomId]);

  const handleSignal = useCallback(
    (signal: ChatSocketSignal) => {
      if (!liveRef.current || revokedRef.current) return;
      if (signal.kind === 'revoked') {
        handleRevoked();
        return;
      }
      void (async () => {
        const latest = messagesRef.current[messagesRef.current.length - 1];
        const query =
          latest === undefined
            ? `?limit=${CHAT_PAGE_SIZE}`
            : `?after=${encodeURIComponent(encodeAfterCursor(latest))}&limit=${CHAT_PAGE_SIZE}`;
        try {
          const response = await fetch(`/api/rooms/${roomId}/messages${query}`);
          if (!liveRef.current || revokedRef.current) return;
          if (response.status === 404 || response.status === 403) {
            handleRevoked();
            return;
          }
          if (!response.ok) return;
          const envelope = (await response.json()) as ChatListEnvelope;
          const fresh = envelope.data.filter(
            (entry) => !messagesRef.current.some((row) => row.id === entry.id),
          );
          if (fresh.length === 0) return;
          setOutgoing((current) =>
            current.filter(
              (entry) =>
                !envelope.data.some((row) => row.clientMessageId === entry.clientMessageId),
            ),
          );
          setMessages((current) => mergeMessages(current, fresh));
          if (atBottomRef.current) {
            requestAnimationFrame(() => scrollToBottom());
          } else {
            setUnseen((count) => count + fresh.length);
          }
        } catch {
          return;
        }
      })();
    },
    [handleRevoked, roomId],
  );

  const { connected, connectFailed, everConnected } = useChatSocket({
    roomId,
    onSignal: handleSignal,
  });

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current && restoreRef.current === null) scrollToBottom();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const pending = restoreRef.current;
    if (pending === null) return;
    const target = scrollRef.current;
    if (target === null) return;
    const anchor = target.querySelector(`[data-message-id="${pending.key}"]`);
    if (anchor === null) return;
    restoreRef.current = null;
    target.scrollTop += anchor.getBoundingClientRect().top - pending.offset;
  });

  useEffect(() => {
    if (connected) void resyncAfterReconnect();
  }, [connected, resyncAfterReconnect]);

  useEffect(() => {
    async function confirmHistory(): Promise<void> {
      try {
        const response = await fetch(`/api/rooms/${roomId}/messages?limit=${CHAT_PAGE_SIZE}`);
        if (!liveRef.current) return;
        if (response.status === 404 || response.status === 403) {
          handleRevoked();
          return;
        }
        if (!response.ok) return;
        const envelope = (await response.json()) as ChatListEnvelope;
        const chronological = [...envelope.data].sort(comparePosition);
        const nextCursor =
          typeof envelope.meta?.nextCursor === 'string' ? envelope.meta.nextCursor : null;
        setMessages((current) =>
          current.length === 0 ? chronological : mergeMessages(current, chronological),
        );
        setCursor((current) => current ?? nextCursor);
        setHistoryChecked(true);
      } catch {
        return;
      }
    }
    if (initialMessages.length === 0) void confirmHistory();
    else setHistoryChecked(true);
  }, [handleRevoked, initialMessages.length, roomId]);

  function updateAtBottom(): void {
    const near = isNearBottom();
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setUnseen(0);
  }

  async function loadOlder(): Promise<void> {
    const node = scrollRef.current;
    if (node === null || cursor === null || loadingOlder) return;
    const list = node.querySelector('[data-testid$="-list"]');
    const anchorChild = list === null ? null : list.querySelector(':scope > li');
    const anchorKey = anchorChild === null ? null : anchorChild.getAttribute('data-message-id');
    const anchorOffset = anchorChild === null ? null : anchorChild.getBoundingClientRect().top;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const response = await fetch(
        `/api/rooms/${roomId}/messages?before=${encodeURIComponent(cursor)}&limit=${CHAT_PAGE_SIZE}`,
      );
      if (!liveRef.current || revokedRef.current) return;
      if (response.status === 404 || response.status === 403) {
        handleRevoked();
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ChatErrorEnvelope | null;
        setOlderError(payload?.error.message ?? 'Could not load older messages.');
        return;
      }
      const envelope = (await response.json()) as ChatListEnvelope;
      const chronological = [...envelope.data].sort(comparePosition);
      if (anchorKey !== null && anchorOffset !== null) {
        restoreRef.current = {
          key: anchorKey,
          offset: anchorOffset,
        };
      }
      setMessages((current) => mergeMessages(chronological, current));
      setCursor(typeof envelope.meta?.nextCursor === 'string' ? envelope.meta.nextCursor : null);
    } catch {
      if (liveRef.current) setOlderError('Could not load older messages.');
    } finally {
      if (liveRef.current) setLoadingOlder(false);
    }
  }

  function handleScroll(): void {
    updateAtBottom();
  }

  function upsertOutgoing(entry: ChatOutgoingEntry): void {
    setOutgoing((current) => {
      const rest = current.filter((row) => row.clientMessageId !== entry.clientMessageId);
      return [...rest, entry];
    });
  }

  async function postOutgoing(entry: ChatOutgoingEntry): Promise<void> {
    upsertOutgoing({ ...entry, status: 'sending', error: null });
    try {
      const response = await fetch(`/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientMessageId: entry.clientMessageId,
          ...(entry.text !== null && entry.text !== '' ? { text: entry.text } : {}),
          ...(entry.imageId !== null ? { imageId: entry.imageId } : {}),
        }),
      });
      if (!liveRef.current || revokedRef.current) return;
      if (response.status === 404 || response.status === 403) {
        handleRevoked();
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ChatErrorEnvelope | null;
        upsertOutgoing({
          ...entry,
          status: 'failed',
          error: chatSendErrorCopy(
            payload?.error.code,
            payload?.error.message ?? 'The message was not sent.',
          ),
        });
        return;
      }
      const envelope = (await response.json()) as ChatSendEnvelope;
      setOutgoing((current) =>
        current.filter((row) => row.clientMessageId !== entry.clientMessageId),
      );
      setMessages((current) => mergeMessages(current, [envelope.data]));
      requestAnimationFrame(() => scrollToBottom());
      atBottomRef.current = true;
      setAtBottom(true);
      setUnseen(0);
    } catch {
      if (!liveRef.current) return;
      upsertOutgoing({
        ...entry,
        status: 'failed',
        error: 'The message was not sent. Check your connection and retry.',
      });
    }
  }

  async function handleSend(input: {
    text: string;
    attachment: ChatComposerAttachment | null;
  }): Promise<void> {
    if (revokedRef.current) return;
    const entry: ChatOutgoingEntry = {
      clientMessageId: crypto.randomUUID(),
      text: input.text === '' ? null : input.text,
      imageId: input.attachment?.imageId ?? null,
      imageLabel: input.attachment?.fileName ?? null,
      status: 'sending',
      createdAt: new Date().toISOString(),
      error: null,
    };
    setSending(true);
    upsertOutgoing(entry);
    requestAnimationFrame(() => scrollToBottom());
    try {
      await postOutgoing(entry);
    } finally {
      if (liveRef.current) setSending(false);
    }
  }

  function handleRetry(clientMessageId: string): void {
    const entry = outgoing.find((row) => row.clientMessageId === clientMessageId);
    if (entry === undefined) return;
    void postOutgoing({ ...entry, error: null });
  }

  function handleDiscard(clientMessageId: string): void {
    setOutgoing((current) => current.filter((row) => row.clientMessageId !== clientMessageId));
  }

  function handleJump(): void {
    markSeen();
    scrollToBottom();
    atBottomRef.current = true;
    setAtBottom(true);
  }

  const empty = historyChecked && messages.length === 0 && outgoing.length === 0;

  return (
    <div
      data-testid={`${testIdPrefix}-conversation`}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-raised"
    >
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <span className="text-small font-medium text-body-secondary">Room conversation</span>
        <span
          data-testid={`${testIdPrefix}-connection`}
          role="status"
          className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${connected && !revoked ? 'bg-success-foreground' : 'bg-muted-foreground'}`}
          />
          {revoked
            ? 'Access ended'
            : connected
              ? 'Connected'
              : everConnected || connectFailed
                ? 'Reconnecting'
                : 'Connecting'}
        </span>
      </div>
      {(connectFailed || (!connected && everConnected)) && !revoked ? (
        <ChatConnectionBanner testIdPrefix={testIdPrefix} />
      ) : null}
      {revoked ? (
        <p
          data-testid={`${testIdPrefix}-revoked`}
          role="alert"
          className="rounded-lg border border-danger-border bg-danger px-3 py-2 text-center text-body leading-body font-medium text-danger-foreground"
        >
          Chat access for this room has ended. Returning to Rooms.
        </p>
      ) : null}
      <div className="relative flex min-h-0 w-full flex-1 flex-col bg-background">
        {cursor !== null ? (
          <div className="flex shrink-0 justify-center border-b border-border bg-surface/80 px-3 py-1.5">
            <button
              data-testid={`${testIdPrefix}-load-older`}
              type="button"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
              className="inline-flex min-h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none disabled:cursor-wait disabled:opacity-60"
            >
              {loadingOlder ? (
                <Loader2 aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <History aria-hidden="true" className="size-3.5" />
              )}
              {loadingOlder ? 'Loading older messages.' : 'Load older messages'}
            </button>
          </div>
        ) : null}
        <div
          ref={scrollRef}
          data-testid={`${testIdPrefix}-scroll`}
          onScroll={handleScroll}
          className="min-h-0 w-full flex-1 overflow-y-auto overscroll-contain p-4 [overflow-anchor:none] sm:px-6 sm:py-5"
          tabIndex={0}
          aria-label={`Messages in ${roomLabel}`}
        >
          {olderError !== null ? (
            <p
              data-testid={`${testIdPrefix}-older-error`}
              role="alert"
              className="mb-3 text-center text-body leading-body font-medium text-danger-foreground"
            >
              {olderError}
            </p>
          ) : null}
          {empty ? (
            <EmptyState
              data-testid={`${testIdPrefix}-empty`}
              icon={MessageCircle}
              className="flex min-h-full justify-center py-8"
              title="No messages yet"
              description="Start the conversation with the first message to this room."
            />
          ) : (
            <ChatMessageList
              messages={messages}
              outgoing={outgoing}
              actorUserId={actorUserId}
              testIdPrefix={testIdPrefix}
              onRetry={handleRetry}
              onDiscard={handleDiscard}
            />
          )}
        </div>
        {!atBottom && unseen > 0 ? (
          <ChatNewMessagePill count={unseen} onJump={handleJump} testIdPrefix={testIdPrefix} />
        ) : null}
      </div>
      {revoked ? (
        <p
          data-testid={`${testIdPrefix}-composer-disabled`}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-small leading-small text-muted-foreground"
        >
          Sending is disabled because chat access ended.{' '}
          <a
            href={backHref}
            className="rounded-lg font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {backLabel}
          </a>
        </p>
      ) : (
        <ChatComposer
          onSend={(input) => void handleSend(input)}
          sending={sending}
          testIdPrefix={testIdPrefix}
        />
      )}
    </div>
  );
}
