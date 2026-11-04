'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PENDING_START_KEY, reconcilePayment } from '@/components/billing/fund-wallet';
import { useRemoteStart } from '@/api/cmsApi';

type State = 'checking' | 'success' | 'failed' | 'pending' | 'starting';

function PaymentReturn() {
  const router = useRouter();
  const params = useSearchParams();
  const paymentId = params.get('payment');
  const remoteStart = useRemoteStart();
  const [state, setState] = useState<State>('checking');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!paymentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState('failed');
      setMessage('No payment was specified.');
      return;
    }
    (async () => {
      let status = 'PENDING';
      for (let attempt = 0; attempt < 10 && status === 'PENDING'; attempt += 1) {
        try {
          status = await reconcilePayment(paymentId);
        } catch (error) {
          setState('failed');
          setMessage(error instanceof Error ? error.message : 'Unable to verify the payment.');
          return;
        }
        if (status === 'PENDING') await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
      if (status === 'FAILED') {
        setState('failed');
        setMessage('The payment was not completed. You have not been charged.');
        return;
      }
      if (status !== 'CAPTURED') {
        setState('pending');
        return;
      }
      const saved = sessionStorage.getItem(PENDING_START_KEY);
      sessionStorage.removeItem(PENDING_START_KEY);
      if (!saved) {
        setState('success');
        return;
      }
      setState('starting');
      try {
        const target = JSON.parse(saved) as { stationId: string; evseId: number; connectorId: number };
        const result = await remoteStart.mutateAsync({ ...target, idempotencyKey: crypto.randomUUID() });
        router.replace(result.sessionId ? `/sessions/${result.sessionId}` : '/sessions');
      } catch (error) {
        setState('success');
        setMessage(error instanceof Error ? `Wallet funded, but charging could not start: ${error.message}` : 'Wallet funded.');
      }
    })();
  }, [paymentId, remoteStart, router]);

  const title = {
    checking: 'Confirming your payment…',
    starting: 'Payment received. Starting your session…',
    success: 'Wallet funded',
    pending: 'Payment still processing',
    failed: 'Payment not completed',
  }[state];

  return (
    <div className="mx-auto w-full max-w-md p-4 pt-14">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription aria-live="polite">
            {state === 'pending'
              ? 'Your provider has not confirmed the payment yet. Your wallet is credited automatically once it does.'
              : message || (state === 'success' ? 'The funds are available in your wallet.' : '')}
          </CardDescription>
        </CardHeader>
        {(state === 'success' || state === 'failed' || state === 'pending') && (
          <CardContent>
            <Button render={<Link href="/settings" />}>Back to billing</Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={null}>
      <PaymentReturn />
    </Suspense>
  );
}
