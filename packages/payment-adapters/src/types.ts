export type PaymentProviderType = "paystack" | "flutterwave" | "remita" | "stripe" | "mock";

export interface PreAuthRequest {
  amount: number;
  currency: string;
  paymentToken: string; // Opaque frontend SDK token or authorization_code
  email?: string;
  customerId?: string;
  metadata?: Record<string, string>;
}

export interface PreAuthResult {
  success: boolean;
  holdId?: string;
  error?: string;
  rawResponse?: unknown;
}

export interface CaptureRequest {
  holdId: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
}

export interface CaptureResult {
  success: boolean;
  transactionReference?: string;
  error?: string;
  rawResponse?: unknown;
}

export interface ChargeRequest {
  amount: number;
  currency: string;
  paymentToken: string;
  email: string;
  reference: string;
}

export interface ChargeResult {
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  providerReference: string;
  error?: string;
}

export interface ChargeVerification {
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  amount?: number;
  currency?: string;
}

export interface CheckoutRequest {
  amount: number;
  currency: string;
  email: string;
  name?: string;
  reference: string;
  callbackUrl: string;
}

export interface CheckoutSession {
  providerReference: string;
  /** Redirect the customer here. */
  url?: string;
  /** Or auto-submit this form (POST) to the action URL. */
  form?: { action: string; fields: Record<string, string> };
}

export interface PaymentAdapter {
  readonly providerName: string;
  initializeCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  charge(req: ChargeRequest): Promise<ChargeResult>;
  verifyCharge(reference: string): Promise<ChargeVerification>;
  preAuthorize(req: PreAuthRequest): Promise<PreAuthResult>;
  capture(req: CaptureRequest): Promise<CaptureResult>;
  cancelHold(holdId: string): Promise<boolean>;
}