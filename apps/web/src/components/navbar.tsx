'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Zap, QrCode, MapPin, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { authClient } from '@/lib/auth-client';

export function Navbar() {
  const { data: session } = authClient.useSession();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-slate-100">
          <Zap className="w-5 h-5 text-amber-400 fill-amber-400" />
          <span>OpenEV</span>
        </Link>

        <nav className="flex items-center gap-1 md:gap-4">
          <Link href="/chargers">
            <Button variant={pathname === '/chargers' ? 'secondary' : 'ghost'} size="sm" className="gap-2">
              <MapPin className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Explore</span>
            </Button>
          </Link>

          <Link href="/scan">
            <Button variant={pathname === '/scan' ? 'secondary' : 'ghost'} size="sm" className="gap-2">
              <QrCode className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Scan QR</span>
            </Button>
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Badge variant="outline" className={session?.user.isAnonymous ? 'border-amber-500/40 text-amber-400 bg-amber-500/10' : 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'}>
            {session?.user.isAnonymous ? 'GUEST' : session?.user.name}
          </Badge>

          {session?.user.isAnonymous ? (
            <Link href="/auth/login">
              <Button size="sm" className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium">
                Sign In
              </Button>
            </Link>
          ) : (
            <Button size="icon" variant="ghost" onClick={() => authClient.signOut()} title="Sign Out">
              <LogOut className="w-4 h-4 text-slate-400" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}