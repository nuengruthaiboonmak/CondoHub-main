import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { STATUS_ICONS, type StatusKind } from './status-icons';
import { cx } from './cx';

export type BadgeVariant = StatusKind;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: LucideIcon;
  children: ReactNode;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  success: 'border-success-border bg-success text-success-foreground',
  warning: 'border-warning-border bg-warning text-warning-foreground',
  danger: 'border-danger-border bg-danger text-danger-foreground',
  info: 'border-info-border bg-info text-info-foreground',
  neutral: 'border-neutral-border bg-neutral text-neutral-foreground',
  pending: 'border-neutral-border bg-neutral text-neutral-foreground',
};

export function Badge({ variant = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  const Icon = icon ?? STATUS_ICONS[variant];
  return (
    <span
      className={cx(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption leading-caption font-medium',
        VARIANT_STYLES[variant],
        className,
      )}
      title={typeof children === 'string' ? children : undefined}
      {...rest}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
