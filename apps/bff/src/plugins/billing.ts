import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import {
  FlutterwavePaymentAdapter,
  MockPaymentAdapter,
  PaystackPaymentAdapter,
  RemitaPaymentAdapter,
} from '@pithcharge/payment-adapters';
import type { PaymentAdapter } from '@pithcharge/payment-adapters';

declare module 'fastify' {
  interface FastifyInstance {
    billing: {
      /** The provider used for saved-card charges and as the default for new checkouts. */
      providerName: string;
      providers: () => string[];
      get: (name: string) => PaymentAdapter | undefined;
      default: () => PaymentAdapter;
    };
  }
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when its payment provider is enabled.`);
  return value;
};

function buildAdapter(name: string): PaymentAdapter {
  switch (name) {
    case 'paystack':
      return new PaystackPaymentAdapter({
        secretKey: required('PAYSTACK_SECRET_KEY'),
        baseUrl: process.env.PAYSTACK_API_URL,
      });
    case 'flutterwave':
      return new FlutterwavePaymentAdapter({
        secretKey: required('FLUTTERWAVE_SECRET_KEY'),
        baseUrl: process.env.FLUTTERWAVE_API_URL,
      });
    case 'remita':
      return new RemitaPaymentAdapter({
        merchantId: required('REMITA_MERCHANT_ID'),
        serviceTypeId: required('REMITA_SERVICE_TYPE_ID'),
        apiKey: required('REMITA_API_KEY'),
        baseUrl: process.env.REMITA_BASE_URL,
      });
    case 'mock':
      return new MockPaymentAdapter();
    default:
      throw new Error(`Unsupported payment provider "${name}".`);
  }
}

const billingPlugin: FastifyPluginAsync = async (fastify) => {
  const names = [...new Set(
    (process.env.PAYMENT_PROVIDERS || 'mock').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
  )];
  if (names.length === 0) throw new Error('PAYMENT_PROVIDERS must list at least one provider.');
  if (process.env.NODE_ENV === 'production' && names.includes('mock')) {
    throw new Error('The mock payment provider is development-only; remove it from PAYMENT_PROVIDERS.');
  }

  const adapters = new Map(names.map((name) => [name, buildAdapter(name)] as const));
  if (adapters.has('mock')) {
    fastify.log.warn('Using the mock payment provider; configure a live provider before production.');
  }
  const first = adapters.get(names[0]!)!;

  fastify.decorate('billing', {
    providerName: first.providerName,
    providers: () => [...adapters.keys()],
    get: (name: string) => adapters.get(name),
    default: () => first,
  });
};

export default fp(billingPlugin, { name: 'billing-plugin' });
