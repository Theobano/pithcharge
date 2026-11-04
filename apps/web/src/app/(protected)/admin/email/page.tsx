'use client';

import { useState } from 'react';
import { useAdminEmailSettings, useAdminMutation } from '@/api/adminApi';
import { Field, runWithToast } from '@/components/admin/admin-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const PROVIDER_LABELS = { smtp: 'SMTP', webhook: 'HTTP relay', none: 'Not configured' } as const;

export default function AdminEmailPage() {
  const { data, isLoading, error } = useAdminEmailSettings();
  const sendTest = useAdminMutation<{ to?: string }>('POST');
  const [to, setTo] = useState('');

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive" role="alert">{(error as Error)?.message ?? 'Unable to load email settings.'}</p>;

  const rows: Array<[string, string]> = [
    ['Provider', PROVIDER_LABELS[data.provider]],
    ['Sender', data.from],
    ['Reply-to', data.replyTo ?? '—'],
    ...(data.smtp
      ? ([
          ['SMTP host', `${data.smtp.host}:${data.smtp.port}`],
          ['Encryption', data.smtp.secure ? 'TLS (implicit)' : 'STARTTLS when offered'],
          ['Authentication', data.smtp.authenticated ? 'Username and password' : 'None'],
        ] as Array<[string, string]>)
      : []),
    ['Email verification', data.verificationRequired ? 'Required at sign-up' : 'Not required'],
  ];

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Outgoing email</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs ${data.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {data.configured ? 'Active' : 'Disabled'}
            </span>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
          </dl>
          {!data.configured && (
            <p className="text-sm text-muted-foreground">
              Set <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> and <code>EMAIL_FROM</code> in the
              API and worker environment, then restart them. Secrets are never shown here.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-medium">Send a test email</h2>
          <Field label="Recipient" hint="Defaults to your own address.">
            <Input type="email" value={to} onChange={(event) => setTo(event.target.value)} placeholder="you@example.com" />
          </Field>
          <Button
            disabled={!data.configured}
            loading={sendTest.isPending}
            onClick={() =>
              runWithToast(
                () => sendTest.mutateAsync({ path: '/email/test', body: to ? { to } : {} }),
                'Test email sent.',
              )
            }
          >
            Send test email
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
