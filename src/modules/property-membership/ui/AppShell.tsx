'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, Menu } from 'lucide-react';
import { Sheet, cx } from '@/shared/ui';
import { UserMenu } from './UserMenu';
import { ADMIN_LINKS, RESIDENT_NAV_LINKS, matchNavHref, type ShellNavLink } from './shellNav';

function Navigation({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections: Array<{ label: string; links: ShellNavLink[] }> = [
    {
      label: 'Workspace',
      links: RESIDENT_NAV_LINKS.filter(
        (link) => !isAdmin || (link.href !== '/' && link.href !== '/invoices'),
      ),
    },
    ...(isAdmin ? [{ label: 'Administration', links: ADMIN_LINKS }] : []),
  ];
  const activeHref = sections
    .flatMap((section) => section.links)
    .filter((link) => matchNavHref(pathname, link.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <div className="flex flex-col gap-7">
      {sections.map((section) => (
        <section key={section.label} aria-label={section.label} className="flex flex-col gap-2">
          <h2 className="px-3 text-caption font-medium text-muted-foreground">{section.label}</h2>
          <ul className="flex flex-col gap-1">
            {section.links.map((link) => {
              const active = link.href === activeHref;
              return (
                <li key={link.testId}>
                  <Link
                    href={link.href}
                    data-testid={link.testId}
                    onClick={() => onNavigate?.()}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none',
                      active
                        ? 'bg-nav-active text-nav-active-foreground'
                        : 'text-body-secondary hover:bg-ghost-hover hover:text-foreground',
                    )}
                  >
                    <link.icon aria-hidden="true" className="size-[18px] shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{link.label}</span>
                    {active ? (
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function AppShell({
  isAdmin,
  username,
  roleLabel,
  children,
}: {
  isAdmin: boolean;
  username: string;
  roleLabel: string;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const current = [...ADMIN_LINKS, ...RESIDENT_NAV_LINKS]
    .filter((link) => matchNavHref(pathname, link.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <div className="min-h-dvh bg-background md:pl-[16.5rem]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[16.5rem] flex-col border-r border-border bg-nav-surface md:flex">
        <Link
          href={isAdmin ? '/admin/buildings' : '/'}
          data-testid="shell-brand"
          className="mx-5 my-6 flex w-fit items-center gap-2.5 rounded-lg text-heading font-semibold tracking-tight text-foreground"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <House aria-hidden="true" className="size-5" />
          </span>
          CondoHub
        </Link>
        <nav
          data-testid={isAdmin ? 'admin-sidebar' : 'resident-sidebar'}
          aria-label="Main navigation"
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-6"
        >
          <Navigation isAdmin={isAdmin} />
        </nav>
        <div className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <UserMenu username={username} roleLabel={roleLabel} />
        </div>
      </aside>
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 md:hidden">
          <button
            type="button"
            data-testid="app-nav-open"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            className="rounded-lg p-2 text-body-secondary hover:bg-ghost-hover"
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <span className="min-w-0 truncate text-body font-semibold">
            {current?.label ?? 'CondoHub'}
          </span>
        </header>
        <div
          className={cx(
            'flex min-w-0 flex-1 flex-col',
            !isAdmin && 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0',
          )}
        >
          {children}
        </div>
        {!isAdmin ? (
          <nav
            data-testid="resident-bottom-nav"
            aria-label="Quick navigation"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
          >
            <ul className="grid grid-cols-5">
              {RESIDENT_NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={matchNavHref(pathname, link.href) ? 'page' : undefined}
                    className={cx(
                      'flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium',
                      matchNavHref(pathname, link.href) ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    <link.icon aria-hidden="true" className="size-5" />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
      <Sheet
        open={navOpen}
        onClose={() => setNavOpen(false)}
        title="CondoHub"
        testId="app-nav-sheet"
        footer={
          <div className="w-full">
            <UserMenu username={username} roleLabel={roleLabel} />
          </div>
        }
      >
        <nav aria-label="Main navigation">
          <Navigation isAdmin={isAdmin} onNavigate={() => setNavOpen(false)} />
        </nav>
      </Sheet>
    </div>
  );
}
