import { Skeleton } from '@/shared/ui';

export default function Loading() {
  return (
    <main
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
      aria-busy="true"
      aria-label="Loading page"
    >
      <Skeleton className="h-9 max-w-52" />
      <Skeleton className="h-5 max-w-96" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <Skeleton key={item} className="h-56 rounded-xl" />
        ))}
      </div>
    </main>
  );
}
