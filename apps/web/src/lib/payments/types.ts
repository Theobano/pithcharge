export interface PaymentIntentParams {
  amount: number;
  currency: 'NGN' | 'USD' | 'EUR';
  email: string;
  stationId: string;
}

export interface PaymentResult {
  success: boolean;
  reference: string;
  error?: string;
}

export interface PaymentAdapter {
  readonly providerName: string;
  createPaymentIntent(params: PaymentIntentParams): Promise<{ checkoutUrl?: string; clientSecret?: string }>;
  verifyPayment(reference: string): Promise<PaymentResult>;
}