import Link from 'next/link';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function ResourceCard({
  href,
  title,
  eyebrow,
  description,
  icon: Icon,
  status,
  metadata,
  testId,
}: {
  href: string;
  title: string;
  eyebrow?: string;
  description?: string | null;
  icon: LucideIcon;
  status?: ReactNode;
  metadata?: ReactNode;
  testId: string;
}) {
  return (
    <article className="group relative flex h-full min-w-0 flex-col rounded-xl border border-border bg-surface p-5 transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-raised motion-reduce:transition-none">
      <div className="mb-6 flex items-center justify-between gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-secondary">
          <Icon aria-hidden="true" className="size-5 text-primary" />
        </span>
        {status}
      </div>
      {eyebrow ? (
        <p className="mb-1 line-clamp-2 break-words text-small text-muted-foreground">{eyebrow}</p>
      ) : null}
      <h2 className="text-heading font-semibold leading-snug text-foreground">
        <Link
          href={href}
          data-testid={testId}
          className="flex items-start gap-3 rounded-lg after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus-ring"
        >
          <span className="line-clamp-2 min-w-0 flex-1 break-words">{title}</span>
          <ArrowUpRight
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary"
          />
        </Link>
      </h2>
      {description ? (
        <p className="mt-2 line-clamp-3 break-words text-small leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {metadata ? (
        <div className="mt-auto pt-5 text-small text-body-secondary">
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4">
            {metadata}
          </div>
        </div>
      ) : null}
    </article>
  );
}
