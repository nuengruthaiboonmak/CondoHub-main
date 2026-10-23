import type { Ref, SelectHTMLAttributes } from 'react';
import { ChevronDown, ListFilter, type LucideIcon } from 'lucide-react';
import { INPUT_CLASS } from './controlClasses';
import { cx } from './cx';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  icon?: LucideIcon;
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ icon: Icon = ListFilter, className, ref, ...props }: SelectProps) {
  return (
    <div data-ui-select className="relative w-full min-w-0">
      <select
        {...props}
        ref={ref}
        className={cx(INPUT_CLASS, className, 'peer truncate pl-10 pr-10')}
      />
      <Icon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:text-disabled-foreground" />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:text-disabled-foreground" />
    </div>
  );
}
