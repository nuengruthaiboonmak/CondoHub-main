import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidthOnMobile?: boolean;
  children: ReactNode;
}

const BASE_STYLES =
  'inline-flex select-none items-center justify-center gap-2 rounded-md text-body font-medium transition-[background-color,color,border-color,opacity,transform] duration-fast ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:active:scale-100 [&_svg]:size-5 [&_svg]:shrink-0';

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-disabled disabled:text-disabled-foreground',
  secondary:
    'border border-input-border bg-surface text-secondary-foreground hover:bg-secondary disabled:border-disabled-border disabled:bg-disabled disabled:text-disabled-foreground',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive-hover disabled:bg-disabled disabled:text-disabled-foreground',
  ghost:
    'text-secondary-foreground hover:bg-ghost-hover hover:text-foreground disabled:text-disabled-foreground disabled:hover:bg-transparent',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-body leading-body',
  md: 'h-10 px-4 text-body leading-body',
  lg: 'h-11 px-5 text-heading leading-heading',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidthOnMobile = false,
  type = 'button',
  disabled = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        BASE_STYLES,
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        fullWidthOnMobile && 'w-full sm:w-auto',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
      {children}
    </button>
  );
}
