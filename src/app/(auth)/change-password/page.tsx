import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import ChangePasswordForm from '@/modules/identity-access/ui/ChangePasswordForm';

export default async function ChangePasswordPage() {
  const actor = await getActorFromSession();
  if (!actor || actor.accountStatus !== 'ACTIVE') redirect('/login');
  if (!actor.mustChangePassword) redirect(actor.isSystemAdmin ? '/admin/buildings' : '/');
  return <ChangePasswordForm />;
}
