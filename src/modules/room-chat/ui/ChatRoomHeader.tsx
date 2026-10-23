'use client';

import Link from 'next/link';
import { ArrowLeft, MessageCircle } from 'lucide-react';

export function ChatRoomHeader({
  roomLabel,
  backHref,
  backLabel,
  testIdPrefix,
}: {
  roomLabel: string;
  backHref: string;
  backLabel: string;
  testIdPrefix: string;
}) {
  return (
    <header className="flex min-w-0 shrink-0 items-center gap-3">
      <Link
        href={backHref}
        data-testid={`${testIdPrefix}-back`}
        aria-label={backLabel}
        title={backLabel}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-body-secondary transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
      </Link>
      <div className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-nav-active text-primary sm:flex">
        <MessageCircle aria-hidden="true" className="size-5" />
      </div>
      <div className="min-w-0">
        <h1
          data-testid={`${testIdPrefix}-title`}
          className="text-title font-semibold leading-title tracking-tight text-foreground sm:text-display sm:leading-display"
        >
          Room chat
        </h1>
        <p
          data-testid={`${testIdPrefix}-room-label`}
          title={roomLabel}
          className="truncate text-small leading-small text-muted-foreground"
        >
          {roomLabel}
        </p>
      </div>
    </header>
  );
}
