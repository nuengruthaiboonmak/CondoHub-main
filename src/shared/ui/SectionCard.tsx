import type { ReactNode } from 'react';
import { cx } from './cx';

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  testId,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={cx('min-w-0 rounded-xl border border-border bg-surface', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-heading font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-small text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="min-w-0 p-5">{children}</div>
    </section>
  );
}
