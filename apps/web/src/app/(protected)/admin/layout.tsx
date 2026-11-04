'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/organizations', label: 'Organizations' },
  { href: '/admin/charging-rates', label: 'Public rates' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/email', label: 'Email' },
  { href: '/admin/audit', label: 'Audit log' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Administrator access required</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your account does not have access to the admin console.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 pt-14 sm:p-6 sm:pt-14">
      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b pb-px" aria-label="Admin sections">
        {tabs.map((tab) => {
          const active = tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-2 text-sm',
                active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
