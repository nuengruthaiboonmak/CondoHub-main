import 'server-only';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { getSenderProfile } from '@/modules/identity-access/application/index';
import { AppShell } from '@/modules/property-membership/ui/AppShell';

export default async function Layout({ children }: { children: ReactNode }) {
  const actor = await getActorFromSession();
  if (actor === null || actor.accountStatus !== 'ACTIVE') redirect('/login');
  if (actor.mustChangePassword) redirect('/change-password');
  if (!actor.isSystemAdmin) redirect('/');
  const profile = await getSenderProfile(actor.userId).catch(() => null);
  return (
    <AppShell
      isAdmin={actor.isSystemAdmin}
      username={profile?.name ?? 'Account'}
      roleLabel={actor.isSystemAdmin ? 'System Admin' : 'Resident'}
    >
      {children}
    </AppShell>
  );
}
