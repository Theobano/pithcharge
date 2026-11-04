import {
  PaymentAdapter,
  PreAuthRequest,
  PreAuthResult,
  CaptureRequest,
  CaptureResult,
  ChargeRequest,
  ChargeResult,
  ChargeVerification,
  CheckoutRequest,
  CheckoutSession,
} from "../types";

export interface PaystackAdapterConfig {
  secretKey: string;
  baseUrl?: string;
}

const zeroDecimalCurrencies = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG",
  "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

function currencyUnit(currency: string) {
  return 10 ** (zeroDecimalCurrencies.has(currency.toUpperCase()) ? 0 : 2);
}

export class PaystackPaymentAdapter implements PaymentAdapter {
  readonly providerName = "paystack";
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(config: PaystackAdapterConfig) {
    if (!config.secretKey) {
      throw new Error("Paystack secretKey is required.");
    }
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl || "https://api.paystack.co";
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = (await response.json()) as {
      status?: boolean;
      message?: string;
      data?: unknown;
    };

    if (!response.ok || data.status === false) {
      throw new Error(data.message || `Paystack API error: ${response.statusText}`);
    }

    return data as T;
  }

  async initializeCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const res = await this.request<{ data: { authorization_url: string; reference: string } }>(
      "/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email: req.email,
          amount: Math.round(req.amount * currencyUnit(req.currency)),
          currency: req.currency.toUpperCase(),
          reference: req.reference,
          callback_url: req.callbackUrl,
          metadata: { purpose: "EV_CHARGING_WALLET_TOP_UP" },
        }),
      },
    );
    return { providerReference: res.data.reference, url: res.data.authorization_url };
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (
      !Number.isFinite(req.amount) ||
      req.amount <= 0 ||
      !Number.isInteger(req.amount * currencyUnit(req.currency))
    ) {
      return {
        status: "FAILED",
        providerReference: req.reference,
        error: "Charge amount must be positive and valid for the currency's minor unit.",
      };
    }

    try {
      const res = await this.request<{
        data: { reference: string; status: string };
      }>("/transaction/charge_token", {
        method: "POST",
        body: JSON.stringify({
          authorization_code: req.paymentToken,
          email: req.email,
          amount: Math.round(req.amount * currencyUnit(req.currency)),
          currency: req.currency.toUpperCase(),
          reference: req.reference,
          metadata: { purpose: "EV_CHARGING_WALLET_TOP_UP" },
        }),
      });

      const confirmed = res.data.status === "success" && res.data.reference === req.reference;
      return {
        status: confirmed ? "SUCCESS" : "FAILED",
        providerReference: res.data.reference,
        error: confirmed ? undefined : "Paystack did not confirm the requested wallet charge.",
      };
    } catch (error) {
      return {
        status: "PENDING",
        providerReference: req.reference,
        error: error instanceof Error ? error.message : "Paystack charge request failed.",
      };
    }
  }

  async verifyCharge(reference: string): Promise<ChargeVerification> {
    const res = await this.request<{
      data: { status: string; amount?: number; currency?: string };
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    const status = res.data.status;
    return {
      status: status === "success"
        ? "SUCCESS"
        : ["failed", "abandoned", "reversed"].includes(status)
          ? "FAILED"
          : "PENDING",
      amount: typeof res.data.amount === "number"
        ? res.data.amount / currencyUnit(res.data.currency ?? "")
        : undefined,
      currency: res.data.currency,
    };
  }

  async preAuthorize(_req: PreAuthRequest): Promise<PreAuthResult> {
    return {
      success: false,
      error: "Paystack authorization-code charges are immediate and cannot be used as payment holds.",
    };
  }

  async capture(_req: CaptureRequest): Promise<CaptureResult> {
    return {
      success: false,
      error: "Paystack does not support capture for authorization-code charges.",
    };
  }

  async cancelHold(_holdId: string): Promise<boolean> {
    return false;
  }
}