// packages/payment-adapters/src/cache.ts
import { PaymentAdapter } from "./types";
import { createPaymentAdapter, PaymentAdapterConfig } from "./factory";

class PaymentAdapterCache {
  // Key: tenantId or credential hash, Value: PaymentAdapter instance
  private cache = new Map<string, PaymentAdapter>();

  getOrCreate(cacheKey: string, config: PaymentAdapterConfig): PaymentAdapter {
    let adapter = this.cache.get(cacheKey);

    if (!adapter) {
      adapter = createPaymentAdapter(config);
      this.cache.set(cacheKey, adapter);
    }

    return adapter;
  }

  // Clear cache entry when tenant updates their API keys in Admin Portal
  invalidate(cacheKey: string): void {
    this.cache.delete(cacheKey);
  }
}

export const tenantPaymentCache = new PaymentAdapterCache();