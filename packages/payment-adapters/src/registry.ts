// packages/payment-adapters/src/registry.ts
import { PaymentAdapter, PaymentProviderType } from "./types";

export class PaymentAdapterRegistry {
  private adapters = new Map<PaymentProviderType, PaymentAdapter>();

  register(provider: PaymentProviderType, adapter: PaymentAdapter): void {
    this.adapters.set(provider, adapter);
  }

  get(provider: PaymentProviderType): PaymentAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Payment provider '${provider}' is not enabled or configured.`);
    }
    return adapter;
  }
}