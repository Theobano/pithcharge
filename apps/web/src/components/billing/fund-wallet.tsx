'use client';

import { useEffect, useState } from 'react';
import { bffUrl } from '@/lib/api/base-url';
import { toApiError } from '@/lib/api/error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';

export const PENDING_START_KEY = 'ev:pending-start';

const LABELS: Record<string, string> = {
  paystack: 'Paystack',
  flutterwave: 'Flutterwave',
  remita: 'Remita',
  mock: 'Test provider',
};

type Checkout = {
  paymentId: string;
  url?: string;
  form?: { action: string; fields: Record<string, string> };
};

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${bffUrl()}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<T>;
}

export async function reconcilePayment(paymentId: string): Promise<string> {
  const result = await bff<{ status: string }>(`/billing/topups/${encodeURIComponent(paymentId)}/reconcile`, { method: 'POST' });
  return result.status;
}

function redirectToCheckout(checkout: Checkout) {
  if (checkout.url) {
    window.location.assign(checkout.url);
    return;
  }
  if (checkout.form) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = checkout.form.action;
    for (const [name, value] of Object.entries(checkout.form.fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }
}

/** Pay by card through a hosted provider checkout; the wallet is credited once the provider confirms. */
export function FundWalletForm({
  currency,
  pendingStart,
  defaultAmount,
}: {
  currency: string;
  /** Saved so the charging session starts automatically after a successful payment. */
  pendingStart?: { stationId: string; evseId: number; connectorId: number };
  defaultAmount?: string;
}) {
  const [providers, setProviders] = useState<string[]>([]);
  const [provider, setProvider] = useState('');
  const [amount, setAmount] = useState(defaultAmount ?? '');

  useEffect(() => {
    let active = true;
    bff<{ data: string[] }>('/billing/payment-providers')
      .then((result) => {
        if (!active) return;
        setProviders(result.data);
        setProvider((current) => current || result.data[0] || '');
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const pay = async () => {
    const value = Number(amount);
    if (!(value > 0) || !provider) {
      toast.add({ type: 'error', description: 'Enter an amount and choose a payment provider.' });
      return;
    }
    try {
      const result = await bff<{ data: Checkout }>('/billing/topups/checkout', {
        method: 'POST',
        body: JSON.stringify({ amount: value, provider, idempotencyKey: crypto.randomUUID() }),
      });
      if (pendingStart) sessionStorage.setItem(PENDING_START_KEY, JSON.stringify(pendingStart));
      else sessionStorage.removeItem(PENDING_START_KEY);
      redirectToCheckout(result.data);
      // Keep the button busy while the browser navigates away.
      await new Promise((resolve) => window.setTimeout(resolve, 10_000));
    } catch (error) {
      toast.add({ type: 'error', description: error instanceof Error ? error.message : 'Unable to start checkout.' });
    }
  };

  if (providers.length === 0) {
    return <p className="text-xs text-muted-foreground">Online payments are not configured. Ask an administrator to fund your wallet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Payment provider">
        {providers.map((name) => (
          <Button
            key={name}
            type="button"
            size="sm"
            role="radio"
            aria-checked={provider === name}
            variant={provider === name ? 'default' : 'outline'}
            onClick={() => setProvider(name)}
          >
            {LABELS[name] ?? name}
          </Button>
        ))}
      </div>
      <Input
        type="number"
        min="0.01"
        max="1000000"
        step="0.01"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder={`Amount (${currency})`}
        aria-label="Amount to add"
      />
      <Button className="w-full" onClick={pay}>Pay by card</Button>
    </div>
  );
}
