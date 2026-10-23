import Link from 'next/link';
import { FILTER_LINK_ACTIVE, FILTER_LINK_BASE, FILTER_LINK_IDLE } from './controlClasses';
import { cx } from './cx';

export interface FilterBarOption {
  value: string;
  label: string;
  href: string;
  testId: string;
}

export function FilterBar({
  label,
  options,
  activeValue,
}: {
  label: string;
  options: FilterBarOption[];
  activeValue: string;
}) {
  return (
    <div
      className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg bg-secondary p-1"
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const active = option.value === activeValue;
        return (
          <Link
            key={option.value}
            data-testid={option.testId}
            href={option.href}
            aria-current={active ? 'page' : undefined}
            className={cx(FILTER_LINK_BASE, active ? FILTER_LINK_ACTIVE : FILTER_LINK_IDLE)}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
