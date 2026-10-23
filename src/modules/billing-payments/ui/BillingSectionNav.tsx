import Link from 'next/link';
import { cx, FILTER_LINK_ACTIVE, FILTER_LINK_BASE, FILTER_LINK_IDLE } from '@/shared/ui';

type BillingSection = 'events' | 'invoices' | 'turnover' | 'jobs' | 'settings';

const SECTIONS: Array<{ key: BillingSection; label: string; href: string; testId: string }> = [
  { key: 'events', label: 'Events', href: '/admin/billing/events', testId: 'billing-nav-events' },
  {
    key: 'invoices',
    label: 'Invoices',
    href: '/admin/billing/invoices',
    testId: 'billing-nav-invoices',
  },
  {
    key: 'turnover',
    label: 'Turnover reviews',
    href: '/admin/billing/turnover-reviews',
    testId: 'billing-nav-turnover',
  },
  {
    key: 'settings',
    label: 'Payment settings',
    href: '/admin/billing/settings',
    testId: 'billing-nav-settings',
  },
  { key: 'jobs', label: 'Job runs', href: '/admin/billing/job-runs', testId: 'billing-nav-jobs' },
];

export function BillingSectionNav({
  current,
  counts,
}: {
  current: BillingSection;
  counts: { events?: number; invoices?: number; unresolved?: number; jobs?: number };
}) {
  const countFor = (key: BillingSection): number | undefined => {
    if (key === 'events') return counts.events;
    if (key === 'invoices') return counts.invoices;
    if (key === 'turnover') return counts.unresolved;
    return key === 'jobs' ? counts.jobs : undefined;
  };
  return (
    <nav
      data-testid="billing-section-nav"
      aria-label="Billing sections"
      className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl bg-secondary p-1.5"
    >
      {SECTIONS.map((section) => {
        const count = countFor(section.key);
        return (
          <Link
            key={section.key}
            data-testid={section.testId}
            href={section.href}
            aria-current={section.key === current ? 'page' : undefined}
            className={cx(
              FILTER_LINK_BASE,
              section.key === current ? FILTER_LINK_ACTIVE : FILTER_LINK_IDLE,
            )}
          >
            {section.label}
            {count !== undefined ? ` · ${count}` : ''}
          </Link>
        );
      })}
    </nav>
  );
}
