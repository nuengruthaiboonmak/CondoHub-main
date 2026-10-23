import { paginationRange } from './paginationRange';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from './cx';

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pagePath: string;
  pageParam?: string;
  querySuffix?: string;
  testId?: string;
  nextTestId?: string;
  prevTestId?: string;
  hideDisabledEnds?: boolean;
}

const LINK_BASE =
  'inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border px-2 text-body leading-body font-medium transition-[background-color,color,border-color] duration-fast ease-out focus-visible:outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-focus-ring';

function PageLink({
  href,
  testId,
  label,
  children,
  current = false,
  disabled = false,
}: {
  href: string;
  testId?: string | undefined;
  label: string;
  children: ReactNode;
  current?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        data-testid={testId}
        className={cx(
          LINK_BASE,
          'cursor-not-allowed border-border bg-surface text-disabled-foreground',
        )}
      >
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      data-testid={testId}
      className={cx(
        LINK_BASE,
        current
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input-border bg-surface text-body-secondary hover:bg-secondary',
      )}
    >
      {children}
    </a>
  );
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  pagePath,
  querySuffix = '',
  pageParam = 'page',
  testId,
  nextTestId,
  prevTestId,
  hideDisabledEnds = false,
}: PaginationProps) {
  const safeTotalPages = Math.max(totalPages, 1);
  const safePage = Math.min(Math.max(page, 1), safeTotalPages);
  const pages = paginationRange(safeTotalPages, safePage);
  const prevDisabled = safePage <= 1;
  const nextDisabled = safePage >= safeTotalPages;
  const hrefForPage = (target: number): string =>
    `${pagePath}?${encodeURIComponent(pageParam)}=${target}${querySuffix}`;

  if (safeTotalPages <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Pagination"
      data-testid={testId}
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-small leading-small text-muted-foreground">
        Page {safePage} of {safeTotalPages} ({totalItems} total)
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {hideDisabledEnds && prevDisabled ? null : (
          <PageLink
            href={hrefForPage(safePage - 1)}
            testId={prevTestId}
            label="Go to previous page"
            disabled={prevDisabled}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </PageLink>
        )}
        {pages.map((pageNumber, index) =>
          pageNumber === 'ellipsis' ? (
            <span
              key={`ellipsis-${index}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground"
            >
              …
            </span>
          ) : (
            <PageLink
              key={pageNumber}
              href={hrefForPage(pageNumber)}
              testId={testId ? `${testId}-page-${pageNumber}` : undefined}
              label={`Go to page ${pageNumber}`}
              current={pageNumber === safePage}
            >
              {pageNumber}
            </PageLink>
          ),
        )}
        {hideDisabledEnds && nextDisabled ? null : (
          <PageLink
            href={hrefForPage(safePage + 1)}
            testId={nextTestId}
            label="Go to next page"
            disabled={nextDisabled}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </PageLink>
        )}
      </div>
    </nav>
  );
}
