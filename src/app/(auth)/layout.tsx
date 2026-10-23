import type { ReactNode } from 'react';
import { Building2, House, KeyRound, Users } from 'lucide-react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-2">
      <section
        className="relative hidden flex-col justify-between border-r border-border bg-nav-surface p-12 lg:flex xl:p-16"
        aria-label="CondoHub"
      >
        <div className="flex items-center gap-3 text-heading font-semibold">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <House aria-hidden="true" className="size-5" />
          </span>
          CondoHub
        </div>
        <div className="my-16 max-w-lg">
          <div
            aria-hidden="true"
            className="mb-9 flex size-20 items-center justify-center rounded-3xl border border-border bg-surface text-primary"
          >
            <Building2 className="size-10" strokeWidth={1.25} />
          </div>
          <h1 className="text-display font-semibold leading-display tracking-display">
            A little closer to home.
          </h1>
          <p className="mt-4 max-w-md text-body leading-relaxed text-body-secondary">
            One place for your rooms, shared spaces, and the community around you.
          </p>
          <div className="mt-10 flex flex-wrap gap-3 text-small text-body-secondary">
            <span className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2">
              <Users className="size-4" aria-hidden="true" />
              Connected community
            </span>
            <span className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2">
              <KeyRound className="size-4" aria-hidden="true" />
              Your personal workspace
            </span>
          </div>
        </div>
        <p className="text-caption text-muted-foreground">Condominium community management</p>
      </section>
      <section className="flex min-w-0 flex-col items-center justify-center px-5 py-12 sm:px-10">
        <div className="mb-8 flex items-center gap-2.5 text-heading font-semibold lg:hidden">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <House className="size-5" aria-hidden="true" />
          </span>
          CondoHub
        </div>
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-[var(--ui-shadow-raised)] sm:p-9">
          {children}
        </div>
      </section>
    </main>
  );
}
