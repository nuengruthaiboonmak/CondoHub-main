import {
  Building2,
  CalendarDays,
  House,
  Megaphone,
  ReceiptText,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface ShellNavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  testId: string;
}

export const RESIDENT_NAV_LINKS: ShellNavLink[] = [
  { href: '/', label: 'Home', icon: House, testId: 'nav-home' },
  { href: '/rooms', label: 'Rooms', icon: Building2, testId: 'nav-my-rooms' },
  { href: '/invoices', label: 'Bills', icon: ReceiptText, testId: 'nav-invoices' },
  { href: '/facilities', label: 'Facilities', icon: CalendarDays, testId: 'nav-facilities' },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench, testId: 'nav-maintenance' },
];

export const ADMIN_LINKS: ShellNavLink[] = [
  { href: '/admin/buildings', label: 'Buildings', icon: Building2, testId: 'nav-buildings' },
  {
    href: '/admin/facilities',
    label: 'Facility management',
    icon: CalendarDays,
    testId: 'nav-admin-facilities',
  },
  { href: '/admin/users', label: 'Users', icon: Users, testId: 'nav-users' },
  {
    href: '/admin/announcements',
    label: 'Announcements',
    icon: Megaphone,
    testId: 'nav-announcements',
  },
  {
    href: '/admin/billing/invoices',
    label: 'Billing',
    icon: ReceiptText,
    testId: 'nav-billing-invoices',
  },
  {
    href: '/admin/maintenance',
    label: 'Maintenance inbox',
    icon: Wrench,
    testId: 'nav-maintenance-inbox',
  },
];

export function matchNavHref(pathname: string, href: string): boolean {
  if (href === '/rooms' && (pathname === '/admin/rooms' || pathname.startsWith('/admin/rooms/')))
    return true;
  if (href === '/') return pathname === '/';
  if (href === '/admin/billing/invoices') return pathname.startsWith('/admin/billing/');
  return pathname === href || pathname.startsWith(`${href}/`);
}
