'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  Bell,
  CreditCard,
  LayoutTemplate,
  Lock,
  Palette,
  Shield,
  SlidersHorizontal,
  UserRound,
  Users,
} from 'lucide-react';
import { authClient, useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import OrganizationAccess from './organization-access';
import NotificationsSettings from './notifications';
import BillingSettings from './billing';

const allTabs = [
  { value: 'general', label: 'General', icon: SlidersHorizontal },
  { value: 'appearance', label: 'Appearance', icon: Palette },
  { value: 'billing', label: 'Billing', icon: CreditCard },
  { value: 'notifications', label: 'Notifications', icon: Bell },
  { value: 'security', label: 'Security', icon: Shield },
  { value: 'organization', label: 'Organization', icon: Users },
] as const;

export default function SettingsPage() {
  const { data: session, isPending } = useSession();
  const { theme, setTheme } = useTheme();
  const isAnonymous = session?.user?.isAnonymous ?? false;
  const currentTheme = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';

  const visibleTabs = useMemo(
    () => (isAnonymous ? allTabs.filter((tab) => tab.value === 'appearance') : allTabs),
    [isAnonymous],
  );

  const [activeTab, setActiveTab] = useState<string>('general');
  const tabValue = visibleTabs.some((t) => t.value === activeTab) ? activeTab : visibleTabs[0].value;

  const [profileName, setProfileName] = useState(session?.user?.name ?? '');
  const [autoStart, setAutoStart] = useState(true);
  const [twoFactor, setTwoFactor] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileName(session?.user?.name ?? '');
  }, [session?.user?.name]);

  const handleProfileSave = async () => {
    if (!session || isAnonymous) return;

    setIsSavingProfile(true);
    try {
      await authClient.updateUser({
        name: profileName.trim(),
      });
      toast.add({
        type: 'success',
        description: 'Profile updated.',
      });
    } catch (error) {
      toast.add({
        type: 'error',
        description: error instanceof Error ? error.message : 'Unable to update profile.',
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!session || isAnonymous) return;

    if (!currentPassword || !newPassword) {
      toast.add({
        type: 'error',
        description: 'Current and new passwords are required.',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.add({
        type: 'error',
        description: 'New passwords do not match.',
      });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.add({
        type: 'success',
        description: 'Password updated successfully.',
      });
    } catch (error) {
      toast.add({
        type: 'error',
        description: error instanceof Error ? error.message : 'Unable to change password.',
      });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  if (isPending) {
    return <div className="mx-auto max-w-6xl p-6 text-sm text-muted-foreground">Loading settings…</div>;
  }

  return (
    <div className="mx-auto w-full space-y-4 p-4 sm:p-6">
      <div className="flex justify-end">
        {!isAnonymous && (
          <Button
            className="w-full md:w-auto"
            onClick={handleProfileSave}
            disabled={isSavingProfile}
          >
            {isSavingProfile ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </div>


      <Tabs
        value={tabValue}
        onValueChange={setActiveTab}
        orientation="vertical"
        className="flex w-full flex-col gap-4 md:flex-row md:items-start md:gap-6"
      >
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto border border-border bg-card p-1.5 md:sticky md:top-20 md:w-60 md:flex-col md:overflow-visible md:p-2"
        >
          {visibleTabs.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveTab(value)}
              aria-current={tabValue === value ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2.5 px-3 py-2 text-sm font-medium transition-colors md:w-full',
                tabValue === value
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-4">
        {!isAnonymous && (
          <TabsContent value="general" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <UserRound className="h-4 w-4" />
                  Profile
                </CardTitle>
                <CardDescription>Manage the details shown across your charging experience.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Display name</label>
                    <Input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Email</label>
                    <Input value={session?.user?.email ?? ''} readOnly className="bg-background" />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 border border-border bg-muted/30 p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Auto-start last session</p>
                    <p className="text-xs text-muted-foreground">Resume your previous charge flow without re-entering the charger code.</p>
                  </div>
                  <Switch checked={autoStart} onCheckedChange={setAutoStart} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <LayoutTemplate className="h-4 w-4" />
                Appearance
              </CardTitle>
              <CardDescription>Personalize the interface to match your preferred style.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className=" border border-border bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Theme</p>
                    <p className="text-xs text-muted-foreground">Choose a theme that matches your device or preference.</p>
                  </div>
                </div>

                <Select
                  value={currentTheme}
                  onValueChange={(value) => setTheme(value as 'system' | 'light' | 'dark')}
                >
                  <SelectTrigger className="w-full sm:w-52">
                    <SelectValue placeholder="Theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {!isAnonymous && (
          <>
            <TabsContent value="organization" className="space-y-4">
              <OrganizationAccess />
            </TabsContent>

            <TabsContent value="billing" className="space-y-4">
              <BillingSettings />
            </TabsContent>

            <TabsContent value="notifications" className="space-y-4">
              <NotificationsSettings />
            </TabsContent>

            <TabsContent value="security" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Lock className="h-4 w-4 " />
                    Security
                  </CardTitle>
                  <CardDescription>Protect your account and manage access controls.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex items-center justify-between gap-3 border border-border bg-muted/30 p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Two-factor authentication</p>
                      <p className="text-xs text-muted-foreground">Require a second step when signing in from a new device.</p>
                    </div>
                    <Switch checked={twoFactor} onCheckedChange={setTwoFactor} />
                  </div>

                  <div className="space-y-3  border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Lock className="h-4 w-4 " />
                      Change password
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <label className="text-sm font-medium text-foreground">Current password</label>
                        <Input
                          type="password"
                          value={currentPassword}
                          onChange={(event) => setCurrentPassword(event.target.value)}
                          placeholder="Enter current password"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">New password</label>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          placeholder="New password"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Confirm password</label>
                        <Input
                          type="password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          placeholder="Confirm new password"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        className=""
                        onClick={handlePasswordChange}
                        disabled={isUpdatingPassword}
                      >
                        {isUpdatingPassword ? 'Updating…' : 'Change password'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
        </div>
      </Tabs>
    </div>
  );
}
