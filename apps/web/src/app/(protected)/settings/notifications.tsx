'use client';

import { toApiError } from '@/lib/api/error';
import { bffUrl } from '@/lib/api/base-url';
import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, Mail, Smartphone } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { useSession } from '@/lib/auth-client';

type Preferences = {
  sessionUpdates: boolean;
  paymentUpdates: boolean;
  chargerUpdates: boolean;
  lowCreditUpdates: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
};

type UserNotification = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

const apiUrl = { toString: bffUrl };
const defaultPreferences: Preferences = {
  sessionUpdates: true,
  paymentUpdates: true,
  chargerUpdates: false,
  lowCreditUpdates: true,
  emailEnabled: true,
  pushEnabled: false,
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export default function NotificationsSettings() {
  const { data: session } = useSession();
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [preferenceResponse, notificationResponse] = await Promise.all([
      request<{ data: Preferences }>('/notifications/preferences'),
      request<{ data: UserNotification[] }>('/notifications/me?take=20'),
    ]);
    setPreferences(preferenceResponse.data);
    setNotifications(notificationResponse.data);
  }, []);

  useEffect(() => {
    if (!session?.user || session.user.isAnonymous) return;
    let active = true;
    Promise.all([
      request<{ data: Preferences }>('/notifications/preferences'),
      request<{ data: UserNotification[] }>('/notifications/me?take=20'),
    ])
      .then(([preferenceResponse, notificationResponse]) => {
        if (!active) return;
        setPreferences(preferenceResponse.data);
        setNotifications(notificationResponse.data);
      })
      .catch((error: unknown) => {
        if (active) {
          toast.add({
            type: 'error',
            description: error instanceof Error ? error.message : 'Unable to load notifications.',
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [session?.user]);

  const registerPush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('Push notifications are not supported by this browser.');
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) throw new Error('Browser push is not configured for this application.');

    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Browser notification permission was not granted.');

    const registration = await navigator.serviceWorker.register('/sw.js');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
    }
    await request('/notifications/push-subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
    });
    return subscription;
  };

  const updatePreference = async (key: keyof Preferences, value: boolean) => {
    setSaving(key);
    const previous = preferences[key];
    setPreferences((current) => ({ ...current, [key]: value }));
    try {
      let subscription: PushSubscription | null = null;
      if (key === 'pushEnabled' && value) subscription = await registerPush();
      await request('/notifications/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      });
      if (key === 'pushEnabled' && !value && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        const existing = await registration?.pushManager.getSubscription();
        if (existing) {
          await request(`/notifications/push-subscriptions?endpoint=${encodeURIComponent(existing.endpoint)}`, {
            method: 'DELETE',
          });
          await existing.unsubscribe();
        }
      }
      if (key === 'pushEnabled' && subscription) {
        toast.add({ type: 'success', description: 'Browser push notifications are enabled.' });
      }
    } catch (error) {
      setPreferences((current) => ({ ...current, [key]: previous }));
      toast.add({
        type: 'error',
        description: error instanceof Error ? error.message : 'Unable to update notification preferences.',
      });
    } finally {
      setSaving(null);
    }
  };

  const markRead = async (notificationId: string) => {
    try {
      await request(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' });
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? { ...notification, readAt: new Date().toISOString() }
            : notification,
        ),
      );
    } catch (error) {
      toast.add({
        type: 'error',
        description: error instanceof Error ? error.message : 'Unable to mark notification as read.',
      });
    }
  };

  const controls: Array<{
    key: keyof Preferences;
    title: string;
    description: string;
    icon?: typeof Bell;
  }> = [
    { key: 'sessionUpdates', title: 'Charging sessions', description: 'Get updates when your charging sessions start and stop.' },
    { key: 'paymentUpdates', title: 'Payments', description: 'Receive wallet and payment activity updates.' },
    { key: 'chargerUpdates', title: 'Charger availability', description: 'Hear about relevant charger status changes.' },
    { key: 'lowCreditUpdates', title: 'Low credit alerts', description: 'Get notified when your assigned wallet reaches its low-credit threshold.' },
    { key: 'emailEnabled', title: 'Email delivery', description: 'Deliver supported alerts to your account email.', icon: Mail },
    { key: 'pushEnabled', title: 'Browser push', description: 'Send alerts to this browser. You can turn this off at any time.', icon: Smartphone },
  ];

  if (loading) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading notification settings…</CardContent></Card>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="h-4 w-4" />
            Notification preferences
          </CardTitle>
          <CardDescription>Choose which account events matter and how to receive them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {controls.map(({ key, title, description, icon: Icon }) => (
            <div key={key} className="flex items-center justify-between gap-4 border border-border bg-muted/30 p-3">
              <div className="flex min-w-0 items-start gap-3">
                {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </div>
              <Switch
                checked={preferences[key]}
                disabled={saving === key}
                onCheckedChange={(checked) => void updatePreference(key, checked)}
                aria-label={title}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent notifications</CardTitle>
          <CardDescription>In-app updates for this account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {notifications.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">You’re all caught up.</p>
          ) : notifications.map((notification) => (
            <article
              key={notification.id}
              className={`border p-3 ${notification.readAt ? 'border-border bg-background' : 'border-primary/30 bg-primary/5'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{notification.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{notification.body}</p>
                  <time className="mt-2 block text-[11px] text-muted-foreground">
                    {new Date(notification.createdAt).toLocaleString()}
                  </time>
                </div>
                {!notification.readAt && (
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => void markRead(notification.id)}
                    aria-label="Mark notification as read"
                    title="Mark as read"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                )}
              </div>
            </article>
          ))}
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={() => void refresh().catch((error: unknown) => toast.add({
                type: 'error',
                description: error instanceof Error ? error.message : 'Unable to refresh notifications.',
              }))}
              className="text-xs font-medium text-primary hover:underline"
            >
              Refresh
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
