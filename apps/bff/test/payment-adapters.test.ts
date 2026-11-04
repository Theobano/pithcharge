import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PaystackPaymentAdapter } from '@pithcharge/payment-adapters';

test('Paystack does not report an immediate authorization-code charge as a hold', async () => {
  const adapter = new PaystackPaymentAdapter({ secretKey: 'test-secret' });

  assert.deepEqual(
    await adapter.preAuthorize({
      amount: 10,
      currency: 'USD',
      paymentToken: 'AUTH_test',
    }),
    {
      success: false,
      error: 'Paystack authorization-code charges are immediate and cannot be used as payment holds.',
    },
  );
  assert.equal(await adapter.cancelHold('charge-reference'), false);
  assert.equal((await adapter.capture({
    holdId: 'charge-reference',
    amount: 10,
    currency: 'USD',
  })).success, false);
});

test('Paystack wallet charge uses a stable provider reference and verifies exact amount', async (context) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ url, body });
    const responseData = url.includes('/transaction/verify/')
      ? { status: 'success', amount: 1050, currency: 'USD' }
      : { reference: 'stable-wallet-reference', status: 'success' };
    return new Response(JSON.stringify({ status: true, data: responseData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const adapter = new PaystackPaymentAdapter({
    secretKey: 'test-secret',
    baseUrl: 'https://paystack.test',
  });
  const charge = await adapter.charge({
    amount: 10.5,
    currency: 'USD',
    paymentToken: 'AUTH_test',
    email: 'driver@example.com',
    reference: 'stable-wallet-reference',
  });
  assert.deepEqual(charge, {
    status: 'SUCCESS',
    providerReference: 'stable-wallet-reference',
    error: undefined,
  });
  assert.equal(calls[0]?.body?.reference, 'stable-wallet-reference');
  assert.equal(calls[0]?.body?.amount, 1050);

  assert.deepEqual(
    await adapter.verifyCharge('stable-wallet-reference'),
    { status: 'SUCCESS', amount: 10.5, currency: 'USD' },
  );
});
