import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { AppError } from '@/shared/utils/errors';
import { isUuid } from '@/shared/utils/idempotency';
import { EmptyState } from '@/shared/ui';
import { getRoomDetail, getRoomLabels } from '@/modules/property-membership/application/index';
import { listMessages } from '@/modules/room-chat/application/index';
import { ChatRoomHeader } from '@/modules/room-chat/ui/ChatRoomHeader';
import { ChatConversation } from '@/modules/room-chat/ui/ChatConversation';

export const dynamic = 'force-dynamic';

export default async function AdminRoomChatPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/buildings');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const { roomId } = await params;
  if (!isUuid(roomId)) redirect('/admin/buildings');
  const room = await getRoomDetail(roomId).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
    throw error;
  });
  if (room === null) {
    return (
      <main
        data-testid="admin-chat-page"
        className="mx-auto w-full max-w-[var(--ui-content-wide)] p-4 sm:p-6"
      >
        <EmptyState
          data-testid="admin-chat-missing"
          title="Chat not available"
          description="This room does not exist."
          action={
            <Link
              data-testid="admin-chat-back"
              href="/admin/buildings"
              className="inline-flex items-center gap-1 text-body leading-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              Back to buildings
            </Link>
          }
        />
      </main>
    );
  }
  const [roomInfo] = await getRoomLabels([roomId]);
  const roomLabel = roomInfo?.label ?? room.name;
  const page = await listMessages(actor, { roomId, limit: 30 }, systemClock.now());
  const initialMessages = [...page.messages].sort((a, b) => {
    const time = a.createdAt.localeCompare(b.createdAt);
    if (time !== 0) return time;
    return a.id.localeCompare(b.id);
  });
  return (
    <main
      data-testid="admin-chat-page"
      className="mx-auto flex h-[calc(100dvh-3.5rem)] min-h-0 w-full max-w-[var(--ui-content-wide)] shrink-0 flex-col gap-4 p-4 md:h-dvh lg:gap-5 lg:p-6"
    >
      <ChatRoomHeader
        roomLabel={roomLabel}
        backHref={`/admin/buildings/${room.buildingId}`}
        backLabel="Back to building"
        testIdPrefix="admin-chat"
      />
      <ChatConversation
        roomId={roomId}
        roomLabel={roomLabel}
        actorUserId={actor.userId}
        initialMessages={initialMessages}
        initialCursor={page.nextCursor}
        backHref="/admin/buildings"
        backLabel="Back to buildings"
        testIdPrefix="admin-chat"
      />
    </main>
  );
}
