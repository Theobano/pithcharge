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

export class MockPaymentAdapter implements PaymentAdapter {
  readonly providerName = "mock";
  private activeHolds: Map<string, { amount: number; currency: string; token: string }> = new Map();
  private readonly charges = new Map<string, { status: 'SUCCESS' | 'FAILED'; amount: number; currency: string }>();

  async initializeCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    this.charges.set(req.reference, { status: 'SUCCESS', amount: req.amount, currency: req.currency.toUpperCase() });
    const url = new URL(req.callbackUrl);
    url.searchParams.set('reference', req.reference);
    return { providerReference: req.reference, url: url.toString() };
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const previous = this.charges.get(req.reference);
    if (previous) {
      return {
        status: previous.status,
        providerReference: req.reference,
        error: previous.status === 'FAILED' ? 'Mock charge was declined.' : undefined,
      };
    }

    const success = req.paymentToken !== 'tok_fail' && req.paymentToken !== 'tok_declined' &&
      Number.isFinite(req.amount) && req.amount > 0;
    this.charges.set(req.reference, {
      status: success ? 'SUCCESS' : 'FAILED',
      amount: req.amount,
      currency: req.currency.toUpperCase(),
    });
    return {
      status: success ? 'SUCCESS' : 'FAILED',
      providerReference: req.reference,
      error: success ? undefined : 'Mock charge was declined.',
    };
  }

  async verifyCharge(reference: string): Promise<ChargeVerification> {
    const charge = this.charges.get(reference);
    if (!charge) return { status: 'PENDING' };
    return { status: charge.status, amount: charge.amount, currency: charge.currency };
  }

  async preAuthorize(req: PreAuthRequest): Promise<PreAuthResult> {
    // Simulate failure scenarios based on token naming
    if (req.paymentToken === "tok_fail" || req.paymentToken === "tok_declined") {
      return {
        success: false,
        error: "Card declined by issuing bank (Mock).",
      };
    }

    if (req.amount <= 0) {
      return {
        success: false,
        error: "Pre-authorization amount must be greater than zero.",
      };
    }

    const holdId = `mock_hold_${Math.random().toString(36).substring(2, 10)}`;
    this.activeHolds.set(holdId, {
      amount: req.amount,
      currency: req.currency,
      token: req.paymentToken,
    });

    return {
      success: true,
      holdId,
      rawResponse: { status: "HOLD_CREATED", holdId },
    };
  }

  async capture(req: CaptureRequest): Promise<CaptureResult> {
    const existingHold = this.activeHolds.get(req.holdId);

    if (!existingHold) {
      return {
        success: false,
        error: `Hold ID ${req.holdId} not found or already released.`,
      };
    }

    this.activeHolds.delete(req.holdId);

    return {
      success: true,
      transactionReference: `mock_tx_${Math.random().toString(36).substring(2, 10)}`,
      rawResponse: { status: "CAPTURED", amountCaptured: req.amount },
    };
  }

  async cancelHold(holdId: string): Promise<boolean> {
    if (!this.activeHolds.has(holdId)) {
      return false;
    }
    this.activeHolds.delete(holdId);
    return true;
  }
}