import { ChargeVerification, CheckoutRequest, CheckoutSession } from "../types";
import { HostedCheckoutAdapter, providerFetch } from "./hosted-checkout.adapter";

export interface FlutterwaveAdapterConfig {
  secretKey: string;
  baseUrl?: string;
}

/** Flutterwave v3 hosted payments (`/payments`) verified by `tx_ref`. */
export class FlutterwavePaymentAdapter extends HostedCheckoutAdapter {
  readonly providerName = "flutterwave";
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(config: FlutterwaveAdapterConfig) {
    super();
    if (!config.secretKey) throw new Error("Flutterwave secretKey is required.");
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl || "https://api.flutterwave.com/v3";
  }

  private headers() {
    return { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" };
  }

  async initializeCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const res = await providerFetch<{ status?: string; message?: string; data?: { link?: string } }>(
      `${this.baseUrl}/payments`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          tx_ref: req.reference,
          amount: req.amount,
          currency: req.currency.toUpperCase(),
          redirect_url: req.callbackUrl,
          customer: { email: req.email, name: req.name },
          meta: { purpose: "EV_CHARGING_WALLET_TOP_UP" },
        }),
      },
    );
    if (res.status !== "success" || !res.data?.link) {
      throw new Error(res.message || "Flutterwave did not return a checkout link.");
    }
    return { providerReference: req.reference, url: res.data.link };
  }

  async verifyCharge(reference: string): Promise<ChargeVerification> {
    try {
      const res = await providerFetch<{
        status?: string;
        data?: { status?: string; amount?: number; currency?: string; tx_ref?: string };
      }>(`${this.baseUrl}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {
        headers: this.headers(),
      });
      const data = res.data;
      if (!data || data.tx_ref !== reference) return { status: "PENDING" };
      const status = String(data.status ?? "").toLowerCase();
      return {
        status: status === "successful" ? "SUCCESS" : ["failed", "cancelled"].includes(status) ? "FAILED" : "PENDING",
        amount: data.amount,
        currency: data.currency,
      };
    } catch {
      // Flutterwave answers 400 until the customer has started a transaction.
      return { status: "PENDING" };
    }
  }
}
