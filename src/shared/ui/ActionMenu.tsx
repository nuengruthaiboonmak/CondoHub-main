'use client';

import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis } from 'lucide-react';

export function ActionMenu({
  label,
  testId,
  children,
  side = 'bottom',
}: {
  label: string;
  testId: string;
  children: ReactNode;
  side?: 'bottom' | 'right';
}) {
  const id = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const contains = (node: Node | null) =>
    !!node && (root.current?.contains(node) || panel.current?.contains(node));
  const items = () =>
    Array.from(
      panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [],
    );
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open || !root.current || !panel.current) return;
    const rect = root.current.getBoundingClientRect();
    const width = panel.current.offsetWidth;
    const height = Math.min(panel.current.scrollHeight + 2, 384, window.innerHeight - 32);
    const below = window.innerHeight - rect.bottom;
    const above = height + 8 > below && rect.top > below;
    const left =
      side === 'right'
        ? rect.right + width + 24 <= window.innerWidth
          ? rect.right + 8
          : rect.left - width - 8
        : rect.right - width;
    const top = side === 'right' ? rect.top : above ? rect.top - height - 8 : rect.bottom + 8;
    setPosition({
      left: Math.max(16, Math.min(left, window.innerWidth - width - 16)),
      top: Math.max(16, Math.min(top, window.innerHeight - height - 16)),
      maxHeight: window.innerHeight - 32,
    });
  }, [open, side]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!contains(event.target as Node)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className="relative shrink-0"
      onBlur={(event) => {
        if (!contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!contains(event.target as Node)) return;
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (!open) {
          setOpen(true);
          requestAnimationFrame(() =>
            items()[event.key === 'ArrowUp' ? items().length - 1 : 0]?.focus(),
          );
          return;
        }
        const choices = items();
        const current = choices.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? choices.length - 1
              : (current + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
        choices[next]?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        data-testid={`${testId}-trigger`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-body-secondary transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
      >
        <Ellipsis aria-hidden="true" className="size-5" />
      </button>
      {mounted
        ? createPortal(
            <div
              ref={panel}
              id={id}
              style={
                position
                  ? { left: position.left, top: position.top, maxHeight: position.maxHeight }
                  : undefined
              }
              role="group"
              aria-label={label}
              data-testid={`${testId}-dropdown`}
              className={`${open ? '' : 'hidden'} animate-ui-dialog fixed z-40 w-56 overflow-x-hidden overflow-y-auto max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface-raised p-1.5 shadow-overlay [&_button]:h-auto [&_button]:min-h-10 [&_button]:w-full [&_button]:max-w-full [&_button]:justify-start [&_button]:gap-2.5 [&_button]:rounded-lg [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-2.5 [&_button]:text-left [&_button]:text-body-secondary [&_button:enabled:hover]:bg-ghost-hover [&_button:disabled]:cursor-not-allowed [&_button:disabled]:bg-transparent [&_button:disabled]:text-disabled-foreground [&_button:disabled]:opacity-100 [&_.bg-destructive:enabled]:text-danger-foreground [&_a]:flex [&_a]:h-auto [&_a]:min-h-10 [&_a]:w-full [&_a]:justify-start [&_a]:gap-2.5 [&_a]:rounded-lg [&_a]:px-3 [&_a]:py-2.5 [&_a:hover]:bg-ghost-hover [&_button_svg]:size-4 [&_a_svg]:size-4 [&_svg]:shrink-0`}
              onClick={(event) => {
                const action = (event.target as HTMLElement).closest('button, a');
                if (action?.matches(':disabled, [aria-disabled="true"]')) return;
                if (
                  panel.current?.contains(event.target as Node) &&
                  (event.target as HTMLElement).closest('button, a')
                )
                  close();
              }}
            >
              <div className="flex flex-col gap-0.5 [&>span]:w-full [&>span]:flex-col [&>div]:w-full [&>div]:flex-col">
                {children}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
