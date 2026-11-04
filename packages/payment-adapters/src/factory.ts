import { PaymentAdapter } from "./types";
import { PaystackPaymentAdapter } from "./providers/paystack.adapter";
import { MockPaymentAdapter } from "./providers/mock.adapter";

type PaymentAdapterProvider = "mock" | "paystack";

export interface PaymentAdapterConfig {
  provider: PaymentAdapterProvider;
  secretKey?: string;
  publicKey?: string;
}

export function createPaymentAdapter(
  config: PaymentAdapterConfig,
): PaymentAdapter {
  switch (config.provider) {
    case "paystack":
      if (!config.secretKey) {
        throw new Error("PaystackPaymentAdapter requires 'secretKey'.");
      }
      const baseUrl = process.env.PAYSTACK_API_URL || "https://api.paystack.co";
      return new PaystackPaymentAdapter({
        secretKey: config.secretKey,
        baseUrl,
      });

    case "mock":
    default:
      return new MockPaymentAdapter();
  }
}
