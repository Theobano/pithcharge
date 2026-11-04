import { createHash } from "node:crypto";
import { ChargeVerification, CheckoutRequest, CheckoutSession } from "../types";
import { HostedCheckoutAdapter, providerFetch } from "./hosted-checkout.adapter";

export interface RemitaAdapterConfig {
  merchantId: string;
  serviceTypeId: string;
  apiKey: string;
  /** Defaults to the Remita demo environment; set the live host in production. */
  baseUrl?: string;
}

const sha512 = (value: string) => createHash("sha512").update(value).digest("hex");

/**
 * Remita RRR flow: generate an RRR, then post the customer to the hosted payment page.
 * The order id (our payment reference) is used to look the payment up again.
 */
export class RemitaPaymentAdapter extends HostedCheckoutAdapter {
  readonly providerName = "remita";
  private readonly config: Required<RemitaAdapterConfig>;

  constructor(config: RemitaAdapterConfig) {
    super();
    if (!config.merchantId || !config.serviceTypeId || !config.apiKey) {
      throw new Error("Remita merchantId, serviceTypeId and apiKey are required.");
    }
    this.config = { baseUrl: "https://demo.remita.net", ...config } as Required<RemitaAdapterConfig>;
  }

  private get gateway() {
    return `${this.config.baseUrl}/remita/exapp/api/v1/send/api`;
  }

  async initializeCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const { merchantId, serviceTypeId, apiKey } = this.config;
    const amount = req.amount.toFixed(2);
    const res = await providerFetch<{ RRR?: string; rrr?: string; statuscode?: string; status?: string }>(
      `${this.gateway}/echannelsvc/merchant/api/paymentinit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `remitaConsumerKey=${merchantId},remitaConsumerToken=${sha512(
            `${merchantId}${serviceTypeId}${req.reference}${amount}${apiKey}`,
          )}`,
        },
        body: JSON.stringify({
          serviceTypeId,
          amount,
          orderId: req.reference,
          payerName: req.name || req.email,
          payerEmail: req.email,
          description: "EV charging wallet top-up",
        }),
      },
    );
    const rrr = res.RRR ?? res.rrr;
    if (!rrr) throw new Error("Remita did not return a payment reference (RRR).");
    return {
      providerReference: req.reference,
      form: {
        action: `${this.config.baseUrl}/remita/ecomm/finalize.reg`,
        fields: {
          merchantId,
          hash: sha512(`${merchantId}${rrr}${apiKey}`),
          rrr,
          responseurl: req.callbackUrl,
        },
      },
    };
  }

  async verifyCharge(reference: string): Promise<ChargeVerification> {
    const { merchantId, apiKey } = this.config;
    try {
      const res = await providerFetch<{ status?: string; amount?: number | string; message?: string }>(
        `${this.config.baseUrl}/remita/exapp/api/v1/send/api/echannelsvc/${merchantId}/${encodeURIComponent(
          reference,
        )}/${sha512(`${reference}${apiKey}${merchantId}`)}/orderstatus.reg`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `remitaConsumerKey=${merchantId},remitaConsumerToken=${sha512(`${reference}${apiKey}${merchantId}`)}`,
          },
        },
      );
      const status = String(res.status ?? "");
      return {
        status: status === "00" || status === "01" ? "SUCCESS" : ["02", "021", "022", "069"].includes(status) ? "FAILED" : "PENDING",
        amount: res.amount === undefined ? undefined : Number(res.amount),
        currency: "NGN",
      };
    } catch {
      return { status: "PENDING" };
    }
  }
}
