import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { searchUserAccounts } from '@/modules/identity-access/application/index';
import { PageHeader } from '@/shared/ui';
import { UsersTable } from './UsersTable';

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; page?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/users');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const result = await searchUserAccounts(actor, { query: params.query, page, pageSize: 20 });
  return (
    <main
      data-testid="admin-users-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Users"
        description="Search accounts, provision new users, reset passwords, deactivate or delete accounts."
      />
      <UsersTable
        actorId={actor.userId}
        users={result.rows.map((row) => ({
          id: row.id,
          username: row.username,
          email: row.email,
          name: row.name,
          accountStatus: row.accountStatus,
          mustChangePassword: row.mustChangePassword,
        }))}
        total={result.total}
        page={page}
        pageSize={20}
        query={params.query ?? ''}
      />
    </main>
  );
}
