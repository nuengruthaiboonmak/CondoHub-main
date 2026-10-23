'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, UserPlus, X, KeyRound, Power, PowerOff } from 'lucide-react';
import {
  ActionMenu,
  ResourceDeleteControl,
  Badge,
  Button,
  DataTable,
  DataTableCell,
  DataTableRow,
  Dialog,
  EmptyState,
  INPUT_CLASS,
  Pagination,
  SectionCard,
  cx,
  useToast,
} from '@/shared/ui';
import { UserProvisionForm, extractProvisionedAccount } from './UserProvisionForm';

export interface AdminUserRow {
  id: string;
  username: string | null;
  email: string;
  name: string;
  accountStatus: 'ACTIVE' | 'SUSPENDED';
  mustChangePassword: boolean;
}

interface UsersTableProps {
  actorId: string;
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
}

async function postJson(path: string, body?: unknown): Promise<{ ok: boolean; payload: unknown }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  return { ok: response.ok, payload };
}

function tempPasswordOf(payload: unknown): string | null {
  return extractProvisionedAccount(payload).tempPassword;
}

type PendingAction =
  | { kind: 'reset'; user: AdminUserRow }
  | { kind: 'suspend'; user: AdminUserRow }
  | { kind: 'reactivate'; user: AdminUserRow };

export function UsersTable({ actorId, users, total, page, pageSize, query }: UsersTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = useState(query);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [oncePassword, setOncePassword] = useState<{ userId: string; password: string } | null>(
    null,
  );
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [provisionPending, setProvisionPending] = useState(false);
  const [provisionOpen, setProvisionOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const querySuffix = query === '' ? '' : `&query=${encodeURIComponent(query)}`;

  async function resetUser(id: string): Promise<void> {
    setBusyId(id);
    try {
      const { ok, payload } = await postJson(`/api/admin/users/${id}/reset-password`);
      if (!ok) {
        toast.error('Reset failed.');
        return;
      }
      const temp = tempPasswordOf(payload);
      if (temp !== null) setOncePassword({ userId: id, password: temp });
      toast.success('Password reset. Temporary password shown once.');
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(id: string, accountStatus: 'ACTIVE' | 'SUSPENDED'): Promise<void> {
    setBusyId(id);
    try {
      const response = await fetch(`/api/admin/users/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountStatus }),
      });
      if (!response.ok) {
        toast.error('Status change failed.');
        return;
      }
      toast.success(
        accountStatus === 'SUSPENDED' ? 'Account deactivated.' : 'Account reactivated.',
      );
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  function confirmPending(): void {
    if (pendingAction === null || busyId !== null) return;
    const action = pendingAction;
    setPendingAction(null);
    if (action.kind === 'reset') void resetUser(action.user.id);
    else void setStatus(action.user.id, action.kind === 'suspend' ? 'SUSPENDED' : 'ACTIVE');
  }

  const pendingLabel =
    pendingAction === null ? '' : (pendingAction.user.username ?? pendingAction.user.email);
  const pendingTitle =
    pendingAction?.kind === 'reset'
      ? 'Reset this password?'
      : pendingAction?.kind === 'suspend'
        ? 'Deactivate this account?'
        : 'Reactivate this account?';
  const pendingTestId =
    pendingAction?.kind === 'reset'
      ? 'admin-users-reset-confirm'
      : pendingAction?.kind === 'suspend'
        ? 'admin-users-suspend-confirm'
        : 'admin-users-reactivate-confirm';

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Accounts"
        description={`${total} ${total === 1 ? 'account' : 'accounts'} in your community`}
        action={
          <Button data-testid="admin-users-provision-open" onClick={() => setProvisionOpen(true)}>
            <UserPlus aria-hidden="true" className="size-4" />
            New user
          </Button>
        }
      >
        <Dialog
          open={provisionOpen}
          busy={provisionPending}
          onClose={() => setProvisionOpen(false)}
          title="Provision user"
          description="Create a system-wide account. A temporary password is shown once."
          size="sm"
          testId="admin-users-provision"
        >
          <UserProvisionForm
            onPendingChange={setProvisionPending}
            onCancel={() => setProvisionOpen(false)}
            onDone={(userId, tempPassword) => {
              setProvisionOpen(false);
              if (tempPassword !== null) {
                setOncePassword({ userId, password: tempPassword });
                toast.success('User provisioned. Temporary password shown once.');
              } else {
                toast.success('User already provisioned.');
              }
              router.refresh();
            }}
          />
        </Dialog>
        <form
          data-testid="admin-users-search"
          className="mb-5 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const params = new URLSearchParams();
            if (search !== '') params.set('query', search);
            router.push(`/admin/users?${params.toString()}`);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              data-testid="admin-users-search-input"
              type="search"
              aria-label="Search users"
              placeholder="Search by username, email, or name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={cx(INPUT_CLASS, 'pr-3 pl-9')}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        {oncePassword !== null ? (
          <div
            data-testid="admin-users-temp-password"
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning p-4"
          >
            <p className="text-body leading-body font-medium text-foreground">
              Temporary password — shown once. Copy it now; it cannot be shown again.
            </p>
            <p className="font-mono text-body leading-body break-all text-foreground">
              {oncePassword.password}
            </p>
            <div>
              <Button variant="secondary" size="sm" onClick={() => setOncePassword(null)}>
                <X aria-hidden="true" className="size-4" />
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
        <DataTable
          testId="admin-users-table"
          caption="Admin user accounts"
          columns={[
            { key: 'username', header: 'Username', width: 170, truncate: true },
            { key: 'name', header: 'Name', width: 230, truncate: true },
            { key: 'email', header: 'Email', width: 230, truncate: true },
            { key: 'status', header: 'Status', width: 170 },
            { key: 'actions', header: 'Actions', width: 110 },
          ]}
          emptyState={<EmptyState title="No users found" description="Try a different search." />}
        >
          {users.map((row) => (
            <DataTableRow key={row.id} rowKey={row.id}>
              <DataTableCell>{row.username ?? '—'}</DataTableCell>
              <DataTableCell>
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-caption font-semibold"
                  >
                    {row.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span title={row.name} className="truncate font-medium text-foreground">
                    {row.name}
                  </span>
                </span>
              </DataTableCell>
              <DataTableCell>{row.email}</DataTableCell>
              <DataTableCell>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={row.accountStatus === 'ACTIVE' ? 'success' : 'neutral'}>
                    {row.accountStatus === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </Badge>
                  {row.mustChangePassword ? (
                    <Badge variant="warning">Must change password</Badge>
                  ) : null}
                </span>
              </DataTableCell>
              <DataTableCell>
                <ActionMenu
                  label={`Actions for ${row.username ?? row.name}`}
                  testId={`admin-users-actions-${row.id}`}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={row.id === actorId || busyId === row.id}
                    onClick={() => setPendingAction({ kind: 'reset', user: row })}
                  >
                    <KeyRound aria-hidden="true" className="size-4" />
                    Reset password
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={row.id === actorId || busyId === row.id}
                    onClick={() =>
                      setPendingAction({
                        kind: row.accountStatus === 'ACTIVE' ? 'suspend' : 'reactivate',
                        user: row,
                      })
                    }
                  >
                    {row.accountStatus === 'ACTIVE' ? (
                      <PowerOff aria-hidden="true" className="size-4" />
                    ) : (
                      <Power aria-hidden="true" className="size-4" />
                    )}
                    {row.accountStatus === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  </Button>
                  <ResourceDeleteControl
                    resource="user"
                    name={row.username ?? row.name}
                    endpoint={`/api/admin/users/${row.id}`}
                    testId="admin-users-delete"
                    triggerTestId={`admin-users-delete-${row.id}-open`}
                    disabled={row.id === actorId}
                    description="This account will be removed from the user directory and signed out immediately. Existing room, billing and message history stay recorded. This account cannot be reactivated after deletion."
                  />
                </ActionMenu>
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTable>
      </SectionCard>
      <Dialog
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        title={pendingTitle}
        description={
          pendingAction?.kind === 'reset'
            ? `Reset the password for ${pendingLabel}? A temporary password is shown once.`
            : pendingAction?.kind === 'suspend'
              ? `Deactivate ${pendingLabel}? The account loses access immediately.`
              : `Reactivate ${pendingLabel}? The account regains access.`
        }
        size="sm"
        testId="admin-users-confirm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button
              data-testid={pendingTestId}
              variant="primary"
              loading={pendingAction !== null && busyId === pendingAction.user.id}
              onClick={confirmPending}
            >
              {pendingAction?.kind === 'reset'
                ? 'Reset password'
                : pendingAction?.kind === 'suspend'
                  ? 'Deactivate account'
                  : 'Reactivate account'}
            </Button>
          </>
        }
      >
        <p
          data-testid="admin-users-confirm-hint"
          className="text-small leading-small text-muted-foreground"
        >
          {pendingAction?.kind === 'reset'
            ? 'The user must change the temporary password at next login.'
            : pendingAction?.kind === 'suspend'
              ? 'Active sessions end and the user cannot sign in while inactive.'
              : 'The user can sign in again with the existing password.'}
        </p>
      </Dialog>
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={total}
        pagePath="/admin/users"
        querySuffix={querySuffix}
        testId="admin-users-pagination"
        nextTestId="admin-users-next"
        prevTestId="admin-users-prev"
        hideDisabledEnds
      />
    </div>
  );
}
