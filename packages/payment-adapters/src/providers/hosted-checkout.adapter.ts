import {
  CaptureRequest,
  CaptureResult,
  ChargeRequest,
  ChargeResult,
  ChargeVerification,
  CheckoutRequest,
  CheckoutSession,
  PaymentAdapter,
  PreAuthRequest,
  PreAuthResult,
} from "../types";

/** Base for providers used only through their hosted checkout page (no saved-token charges or holds). */
export abstract class HostedCheckoutAdapter implements PaymentAdapter {
  abstract readonly providerName: string;
  abstract initializeCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  abstract verifyCharge(reference: string): Promise<ChargeVerification>;

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    return {
      status: "FAILED",
      providerReference: req.reference,
      error: `${this.providerName} only supports hosted checkout payments.`,
    };
  }

  async preAuthorize(_req: PreAuthRequest): Promise<PreAuthResult> {
    return { success: false, error: `${this.providerName} does not support payment holds.` };
  }

  async capture(_req: CaptureRequest): Promise<CaptureResult> {
    return { success: false, error: `${this.providerName} does not support capture.` };
  }

  async cancelHold(_holdId: string): Promise<boolean> {
    return false;
  }
}

export async function providerFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text.replace(/^jsonp\s*\(|\)\s*$/g, "")) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    const message = (body as { message?: string }).message;
    throw new Error(message || `Payment provider error: ${response.status}`);
  }
  return body as T;
}
