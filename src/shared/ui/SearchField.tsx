import { Search } from 'lucide-react';
import { Button } from './Button';
import { INPUT_CLASS } from './controlClasses';

export function SearchField({
  query,
  label,
  total,
}: {
  query: string;
  label: string;
  total: number;
}) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-0 flex-1 sm:max-w-sm">
        <span className="sr-only">{label}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
        />
        <input
          name="query"
          defaultValue={query}
          placeholder={label}
          className={`${INPUT_CLASS} pl-10`}
        />
      </label>
      <Button type="submit" variant="secondary">
        Search
      </Button>
      <span className="ml-auto text-small text-muted-foreground">
        {total} {total === 1 ? 'result' : 'results'}
      </span>
    </form>
  );
}
