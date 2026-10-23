import 'server-only';
import { redirect } from 'next/navigation';
import { z } from 'zod';

export default async function AdminOwnershipPage({
  searchParams,
}: {
  searchParams: Promise<{ roomId?: string }>;
}) {
  const { roomId } = await searchParams;
  redirect(z.string().uuid().safeParse(roomId).success ? `/rooms/${roomId}` : '/rooms');
}
