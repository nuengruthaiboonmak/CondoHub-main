'use client';

import { useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { RoomMemberAddForm, type MemberTenancyOption } from './RoomMemberAddForm';
import { TenantAccountForm } from './TenantAccountForm';

export function RentalTenantForm({
  roomId,
  tenancy,
  canCreateAccount,
}: {
  roomId: string;
  tenancy: MemberTenancyOption;
  canCreateAccount: boolean;
}) {
  const [method, setMethod] = useState<'existing' | 'new' | null>(null);
  if (method === 'new') return <TenantAccountForm roomId={roomId} />;
  if (method === 'existing' || !canCreateAccount)
    return <RoomMemberAddForm roomId={roomId} activeTenancies={[tenancy]} />;
  return (
    <div className="flex flex-col gap-3">
      <p className="mb-2 text-body text-body-secondary">
        Does the tenant already have a CondoHub account?
      </p>
      <button
        type="button"
        data-testid="tenant-existing-option"
        onClick={() => setMethod('existing')}
        className="flex items-center gap-4 rounded-xl border border-border p-4 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <Users aria-hidden="true" className="size-5 shrink-0 text-primary" />
        <span>
          <span className="block text-body font-semibold">Use an existing account</span>
          <span className="mt-1 block text-small text-muted-foreground">
            Add the tenant using their username.
          </span>
        </span>
      </button>
      <button
        type="button"
        data-testid="tenant-account-option"
        onClick={() => setMethod('new')}
        className="flex items-center gap-4 rounded-xl border border-border p-4 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <UserPlus aria-hidden="true" className="size-5 shrink-0 text-primary" />
        <span>
          <span className="block text-body font-semibold">Create a new account</span>
          <span className="mt-1 block text-small text-muted-foreground">
            Create sign-in details and add the tenant together.
          </span>
        </span>
      </button>
    </div>
  );
}
