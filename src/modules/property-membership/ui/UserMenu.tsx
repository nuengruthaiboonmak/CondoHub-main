'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, KeyRound, Loader2, LogOut } from 'lucide-react';
import { Dialog, useToast } from '@/shared/ui';
import ChangePasswordForm from '@/modules/identity-access/ui/ChangePasswordForm';
import { authClient } from '@/modules/identity-access/ui/authClient';

export function UserMenu({ roleLabel, username }: { roleLabel: string; username: string }) {
  const menuId = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordPending, setPasswordPending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error !== null) throw new Error('Sign out failed');
      router.push('/login');
      router.refresh();
    } catch {
      toast.error('Sign out failed', { description: 'Retry in a moment.' });
      setSigningOut(false);
    }
  }

  return (
    <>
      <div
        ref={rootRef}
        className="relative min-w-0"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          data-testid="user-menu-trigger"
          aria-label="Account options"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 w-full items-center gap-2.5 rounded-xl p-1.5 text-left hover:bg-ghost-hover"
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-small font-semibold text-secondary-foreground"
            aria-hidden="true"
          >
            {username.trim().slice(0, 2).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              data-testid="user-menu-username"
              className="truncate text-small font-semibold text-foreground"
            >
              {username}
            </span>
            <span data-testid="role-label" className="text-caption text-muted-foreground">
              {roleLabel}
            </span>
          </span>
          <ChevronUp aria-hidden="true" className="size-4 text-muted-foreground" />
        </button>
        {open ? (
          <div
            id={menuId}
            data-testid="user-menu-dropdown"
            className="animate-ui-dialog absolute inset-x-0 bottom-full z-50 mb-2 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-border bg-surface-raised p-1.5 shadow-overlay"
          >
            <div className="mb-1 border-b border-border px-3 py-3">
              <p className="truncate text-body font-semibold">{username}</p>
              <p className="text-small text-muted-foreground">{roleLabel}</p>
            </div>
            <button
              type="button"
              data-testid="user-menu-change-password"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                setPasswordOpen(true);
              }}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-body text-body-secondary hover:bg-ghost-hover"
            >
              <KeyRound aria-hidden="true" className="size-4" />
              Change password
            </button>
            <button
              data-testid="user-menu-sign-out"
              type="button"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-body text-danger-foreground hover:bg-danger disabled:opacity-60"
            >
              {signingOut ? (
                <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              ) : (
                <LogOut aria-hidden="true" className="size-4" />
              )}
              {signingOut ? 'Signing out' : 'Sign out'}
            </button>
          </div>
        ) : null}
      </div>
      <Dialog
        open={passwordOpen}
        busy={passwordPending}
        onClose={() => {
          if (!passwordPending) setPasswordOpen(false);
        }}
        title="Change password"
        description="Choose a new password of at least 12 characters. You will sign in again after saving."
        testId="account-password-dialog"
      >
        <ChangePasswordForm
          mode="account"
          onCancel={() => setPasswordOpen(false)}
          onPendingChange={setPasswordPending}
        />
      </Dialog>
    </>
  );
}
