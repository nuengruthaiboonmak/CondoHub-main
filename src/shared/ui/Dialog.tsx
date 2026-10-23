'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  actions?: ReactNode | undefined;
  size?: DialogSize | undefined;
  testId?: string | undefined;
  presentation?: 'dialog' | 'sheet';
  className?: string | undefined;
  busy?: boolean | undefined;
}

let activeOverlays = 0;
let previousBodyOverflow = '';

const SIZES: Record<DialogSize, string> = {
  sm: 'max-w-[25rem]',
  md: 'max-w-[32rem]',
  lg: 'max-w-[42rem]',
  xl: 'max-w-[56rem]',
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  size = 'md',
  testId,
  presentation = 'dialog',
  className,
  busy = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const previousFocus = document.activeElement;
    if (activeOverlays === 0) previousBodyOverflow = document.body.style.overflow;
    activeOverlays += 1;
    element.showModal();
    const firstField = bodyRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)',
    );
    firstField?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      activeOverlays -= 1;
      if (activeOverlays === 0) document.body.style.overflow = previousBodyOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <dialog
      ref={ref}
      data-testid={testId}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            if (!busy) onClose();
        }
      }}
      className={cx(
        'w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-hidden border border-border bg-surface-raised p-0 text-foreground shadow-overlay backdrop:bg-overlay',
        presentation === 'sheet'
          ? 'animate-ui-sheet fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-md rounded-l-xl'
          : 'animate-ui-dialog m-auto rounded-2xl',
        presentation === 'dialog' && SIZES[size],
        className,
      )}
    >
      <div
        className={cx(
          'flex max-h-[calc(100dvh-2rem)] flex-col',
          presentation === 'sheet' && 'h-dvh max-h-dvh',
        )}
      >
        <div className="flex shrink-0 items-start gap-4 border-b border-border px-5 py-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-title font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1 text-small leading-relaxed text-muted-foreground"
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close dialog"
            data-testid={testId ? `${testId}-close` : undefined}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground enabled:hover:bg-ghost-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div
          ref={bodyRef}
          data-ui-dialog-body
          className={cx(
            'min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-5 py-5 sm:px-6',
            presentation === 'sheet' && 'flex-1',
          )}
        >
          {children}
        </div>
        {actions ? (
          <div
            data-ui-dialog-actions
            className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-background px-5 py-4 sm:px-6 [&>button]:min-h-10"
          >
            {actions}
          </div>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}
