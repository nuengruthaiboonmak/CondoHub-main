import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cx } from './cx';

export interface PageHeaderProps {
  title: string;
  titleTestId?: string;
  descriptionTestId?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  backTestId?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  testId?: string;
  className?: string;
}

export function PageHeader({
  title,
  titleTestId,
  descriptionTestId,
  description,
  backHref,
  backLabel = 'Back',
  backTestId,
  actions,
  breadcrumb,
  testId,
  className,
}: PageHeaderProps) {
  return (
    <div data-testid={testId} className={cx('flex flex-col gap-3', className)}>
      {breadcrumb ? <nav aria-label="Breadcrumb">{breadcrumb}</nav> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {backHref ? (
            <a
              href={backHref}
              data-testid={backTestId}
              className="mb-1 inline-flex items-center gap-1.5 rounded-lg text-body leading-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {backLabel}
            </a>
          ) : null}
          <h1
            data-testid={titleTestId}
            className="break-words text-display leading-display font-semibold tracking-display text-foreground"
          >
            {title}
          </h1>
          {description ? (
            <p
              data-testid={descriptionTestId}
              className="mt-1 max-w-2xl text-small leading-small text-muted-foreground"
            >
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
