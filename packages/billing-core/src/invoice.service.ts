import { db, Prisma } from "@pithcharge/db";
import {
  getOrCreateLedgerAccount,
  money,
  postBalancedLedgerTransaction,
} from "./financial.service";
import { createUserNotification } from "@pithcharge/notifications";
import {
  BillingCycle,
  CycleSettings,
  CycleUnit,
  cycleAt,
  cycleIndexContaining,
  describeCycle,
  dueCycles,
  resolveAnchor,
} from "./billing-cycle";

type Logger = {
  info: (context: object, message: string) => void;
  error: (context: object, message: string) => void;
};

type Policy = Awaited<ReturnType<typeof db.billingPolicy.findFirstOrThrow>>;
type SweptSession = {
  id: string;
  receivableAmount: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  billedAt: Date | null;
};

export type InvoiceTrigger = "SCHEDULED" | "MANUAL";

export type InvoiceOutcome =
  | {
      status: "ISSUED" | "EXISTING";
      invoice: Awaited<ReturnType<typeof db.monthlyInvoice.findFirstOrThrow>>;
    }
  | { status: "NOTHING_TO_INVOICE" };

export function cycleSettingsOf(policy: Policy): CycleSettings {
  return {
    unit: policy.billingCycleUnit as CycleUnit,
    interval: policy.billingCycleInterval,
    anchor: policy.billingCycleAnchor,
    createdAt: policy.createdAt,
    cursor: policy.invoiceCursor,
  };
}

/** The billing cycle in progress for an organization, used for spend and usage displays. */
export function currentBillingPeriod(
  policy: Policy | null,
  at = new Date(),
): BillingCycle {
  if (!policy) {
    return {
      start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
      end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
    };
  }
  const settings = cycleSettingsOf(policy);
  const anchor = resolveAnchor(settings);
  return cycleAt(
    settings,
    Math.max(
      0,
      cycleIndexContaining(anchor, settings.unit, settings.interval, at),
    ),
  );
}

async function issueInvoice(
  policy: Policy,
  options: {
    trigger: InvoiceTrigger;
    periodStart?: Date;
    periodEnd: Date;
    issuedBy?: string;
  },
): Promise<InvoiceOutcome> {
  const { trigger, periodEnd, issuedBy } = options;
  const scheduled = trigger === "SCHEDULED";
  const organizationId = policy.organizationId;
  const minimumSpend = scheduled ? money(policy.monthlyMinimumSpend) : money(0);

  const result = await db.$transaction(
    async (transaction: Prisma.TransactionClient) => {
      const sessions: SweptSession[] =
        await transaction.chargingSession.findMany({
          where: {
            organizationId,
            status: "COMPLETED",
            invoiceId: null,
            billedAt: { lt: periodEnd },
          },
          select: {
            id: true,
            receivableAmount: true,
            totalCost: true,
            billedAt: true,
          },
        });
      const earliest = sessions.reduce<Date | null>(
        (min, item) =>
          item.billedAt && (!min || item.billedAt < min) ? item.billedAt : min,
        null,
      );
      const periodStart = options.periodStart ?? earliest ?? periodEnd;
      const idempotencyKey = scheduled
        ? `invoice:${organizationId}:${periodStart.toISOString()}`
        : `invoice-manual:${organizationId}:${periodEnd.toISOString()}`;

      const existing =
        (await transaction.monthlyInvoice.findUnique({
          where: { idempotencyKey },
        })) ??
        (scheduled
          ? await transaction.monthlyInvoice.findFirst({
              where: { organizationId, periodStart, trigger: "SCHEDULED" },
            })
          : null);
      if (existing) return { status: "EXISTING" as const, invoice: existing };

      const usageCharges = sessions.reduce(
        (sum, item) => sum.plus(item.receivableAmount),
        money(0),
      );
      let actualSpend = sessions.reduce(
        (sum, item) => sum.plus(item.totalCost),
        money(0),
      );
      let shortfall = money(0);
      if (scheduled) {
        const spend = await transaction.chargingSession.aggregate({
          where: {
            organizationId,
            status: "COMPLETED",
            billedAt: { gte: periodStart, lt: periodEnd },
          },
          _sum: { totalCost: true },
        });
        actualSpend = money(spend._sum.totalCost ?? 0);
        shortfall = Prisma.Decimal.max(
          new Prisma.Decimal(0),
          minimumSpend.minus(actualSpend),
        );
      }
      const amountDue = usageCharges.plus(shortfall);

      const nothingToBill = sessions.length === 0 && minimumSpend.isZero();
      if (amountDue.isZero() && (!scheduled || nothingToBill)) {
        return { status: "NOTHING_TO_INVOICE" as const };
      }

      const dueAt = new Date(periodEnd);
      dueAt.setUTCDate(dueAt.getUTCDate() + policy.paymentTermDays);
      const invoice = await transaction.monthlyInvoice.create({
        data: {
          organizationId,
          idempotencyKey,
          periodStart,
          periodEnd,
          actualSpend,
          minimumSpend,
          usageCharges,
          shortfallCharges: shortfall,
          sessionCount: sessions.length,
          trigger,
          issuedBy,
          amountDue,
          currency: policy.currency,
          status: amountDue.isZero() ? "PAID" : "ISSUED",
          ...(amountDue.gt(0) ? { dueAt } : { paidAt: new Date() }),
        },
      });
      if (sessions.length > 0) {
        await transaction.chargingSession.updateMany({
          where: { id: { in: sessions.map((item) => item.id) } },
          data: { invoiceId: invoice.id },
        });
      }

      // Session receivables were posted to the ledger when each session settled; only the
      // minimum-spend shortfall is new revenue.
      if (shortfall.gt(0)) {
        const receivableAccount = await getOrCreateLedgerAccount(transaction, {
          organizationId,
          currency: policy.currency,
          code: "ACCOUNTS_RECEIVABLE",
          type: "ACCOUNTS_RECEIVABLE",
        });
        const revenueAccount = await getOrCreateLedgerAccount(transaction, {
          organizationId,
          currency: policy.currency,
          code: "CHARGING_REVENUE",
          type: "CHARGING_REVENUE",
        });
        await postBalancedLedgerTransaction(transaction, {
          idempotencyKey: `invoice-minimum:${invoice.id}`,
          organizationId,
          referenceType: "MONTHLY_MINIMUM_INVOICE",
          referenceId: invoice.id,
          description: `Minimum spend shortfall for ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`,
          currency: policy.currency,
          entries: [
            {
              accountId: receivableAccount.id,
              direction: "DEBIT",
              amount: shortfall,
            },
            {
              accountId: revenueAccount.id,
              direction: "CREDIT",
              amount: shortfall,
            },
          ],
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: issuedBy,
          organizationId,
          action: "billing.invoice.issued",
          targetType: "MonthlyInvoice",
          targetId: invoice.id,
          metadata: {
            trigger,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            sessionCount: sessions.length,
            usageCharges: usageCharges.toString(),
            shortfallCharges: shortfall.toString(),
            amountDue: amountDue.toString(),
            currency: policy.currency,
          },
        },
      });
      return { status: "ISSUED" as const, invoice };
    },
  );

  if (result.status === "ISSUED" && result.invoice.amountDue.gt(0)) {
    await notifyInvoiceIssued(policy, result.invoice);
  }
  return result;
}

async function notifyInvoiceIssued(
  policy: Policy,
  invoice: Awaited<ReturnType<typeof db.monthlyInvoice.findFirstOrThrow>>,
) {
  const admins: Array<{ userId: string }> = await db.member.findMany({
    where: {
      organizationId: policy.organizationId,
      role: { in: ["admin", "owner"] },
    },
    select: { userId: true },
  });
  const range = `${invoice.periodStart.toLocaleDateString("en", { timeZone: "UTC" })} – ${invoice.periodEnd.toLocaleDateString("en", { timeZone: "UTC" })}`;
  const dueLabel = invoice.dueAt
    ? ` Due ${invoice.dueAt.toLocaleDateString("en", { timeZone: "UTC" })}.`
    : "";
  await Promise.all(
    admins.map((member) =>
      createUserNotification({
        userId: member.userId,
        organizationId: policy.organizationId,
        eventKey: `monthly-invoice:${invoice.id}`,
        title: "New invoice issued",
        body: `${Number(invoice.amountDue).toLocaleString("en", { style: "currency", currency: invoice.currency })} for ${range} (${invoice.sessionCount} sessions).${dueLabel}`,
        category: "paymentUpdates",
        data: {
          invoiceId: invoice.id,
          amountDue: invoice.amountDue.toString(),
          currency: invoice.currency,
        },
      }),
    ),
  );
}

const AUTO_INVOICE_FILTER = {
  autoInvoice: true,
  OR: [
    { billingMode: "POSTPAID" as const },
    { monthlyMinimumSpend: { gt: 0 } },
  ],
};

/** Organizations that currently have at least one billing cycle ready to invoice. */
export async function listOrganizationsDueForInvoicing(
  at = new Date(),
): Promise<string[]> {
  const policies = await db.billingPolicy.findMany({
    where: AUTO_INVOICE_FILTER,
  });
  return policies
    .filter(
      (policy: Policy) => dueCycles(cycleSettingsOf(policy), at).length > 0,
    )
    .map((policy: Policy) => policy.organizationId);
}

/**
 * Issues every scheduled invoice that is due for one organization. Throws on failure so a job
 * runner can retry; the cursor keeps already-invoiced cycles from being repeated.
 */
export async function generateDueInvoicesForOrganization(
  organizationId: string,
  logger: Logger,
  at = new Date(),
) {
  const policy = await db.billingPolicy.findFirst({
    where: { organizationId, ...AUTO_INVOICE_FILTER },
  });
  if (!policy) return { cycles: 0, issued: 0 };
  const cycles = dueCycles(cycleSettingsOf(policy), at);
  let issued = 0;
  for (const cycle of cycles) {
    try {
      const outcome = await issueInvoice(policy, {
        trigger: "SCHEDULED",
        periodStart: cycle.start,
        periodEnd: cycle.end,
      });
      await db.billingPolicy.update({
        where: { organizationId },
        data: { invoiceCursor: cycle.end },
      });
      if (outcome.status === "ISSUED") issued += 1;
    } catch (error) {
      logger.error(
        { err: error, organizationId, period: cycle.start.toISOString() },
        "Scheduled invoice generation failed",
      );
      throw error;
    }
  }
  return { cycles: cycles.length, issued };
}

/** Issues every due scheduled invoice for all organizations in-process. Safe to run repeatedly. */
export async function generateDueInvoices(logger: Logger, at = new Date()) {
  const organizationIds = await listOrganizationsDueForInvoicing(at);
  let issued = 0;
  let processed = 0;
  for (const organizationId of organizationIds) {
    try {
      const result = await generateDueInvoicesForOrganization(
        organizationId,
        logger,
        at,
      );
      issued += result.issued;
      processed += 1;
    } catch {
      // Already logged; continue with the remaining organizations.
    }
  }
  logger.info(
    { organizationCount: processed, invoicesIssued: issued },
    "Scheduled invoice batch completed",
  );
  return { processed, issued };
}

/** Invoices all not-yet-invoiced completed sessions of an organization immediately. */
export async function issueInvoiceNow(
  organizationId: string,
  issuedBy: string,
  at = new Date(),
) {
  const policy = await db.billingPolicy.findUnique({
    where: { organizationId },
  });
  if (!policy) return { status: "NOTHING_TO_INVOICE" as const };
  return issueInvoice(policy, { trigger: "MANUAL", periodEnd: at, issuedBy });
}

export { describeCycle };
