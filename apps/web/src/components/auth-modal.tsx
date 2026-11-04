'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserCheck, UserX, KeyRound, Mail } from 'lucide-react';

export interface DriverProfile {
  isGuest: boolean;
  email?: string;
  name?: string;
  token?: string;
}

interface AuthCardProps {
  currentProfile: DriverProfile;
  onProfileChange: (profile: DriverProfile) => void;
}

export function AuthCard({ currentProfile, onProfileChange }: AuthCardProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  const handleDriverLogin = (e: React.FormEvent) => {
    e.preventDefault();
    onProfileChange({
      isGuest: false,
      email: email || 'driver@platform.ev',
      name: 'Adedotun (Driver)',
      token: 'mock-driver-jwt-token-xyz',
    });
  };

  const handleGuestContinue = (e: React.FormEvent) => {
    e.preventDefault();
    onProfileChange({
      isGuest: true,
      email: guestEmail || 'guest@anon.ev',
      name: 'Guest Driver',
    });
  };

  return (
    <Card className="bg-slate-900 border-slate-800 text-slate-100 mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            {currentProfile.isGuest ? (
              <UserX className="w-4 h-4 text-amber-400" />
            ) : (
              <UserCheck className="w-4 h-4 text-emerald-400" />
            )}
            Driver Identity
          </CardTitle>
          <span className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300 font-mono">
            {currentProfile.isGuest ? 'GUEST MODE' : 'AUTHENTICATED'}
          </span>
        </div>
        <CardDescription className="text-slate-400 text-xs">
          Charge instantly as a guest or sign in to track history.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue={currentProfile.isGuest ? 'guest' : 'account'} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-slate-950 border border-slate-800">
            <TabsTrigger value="guest" className="text-xs">
              Guest Quick Charge
            </TabsTrigger>
            <TabsTrigger value="account" className="text-xs">
              Driver Account
            </TabsTrigger>
          </TabsList>

          {/* Guest Flow */}
          <TabsContent value="guest" className="pt-4 space-y-3">
            <form onSubmit={handleGuestContinue} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Receipt Email (Optional)
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                  <Input
                    type="email"
                    placeholder="guest@example.com"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    className="pl-9 bg-slate-950 border-slate-800 text-sm"
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="outline"
                className="w-full border-slate-700 hover:bg-slate-800 text-xs"
              >
                Use Guest Session
              </Button>
            </form>
          </TabsContent>

          {/* Account Login Flow */}
          <TabsContent value="account" className="pt-4 space-y-3">
            <form onSubmit={handleDriverLogin} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                  <Input
                    type="email"
                    required
                    placeholder="driver@platform.ev"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9 bg-slate-950 border-slate-800 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Password</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                  <Input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 bg-slate-950 border-slate-800 text-sm"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold text-xs"
              >
                Sign In & Link Charging Wallet
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}