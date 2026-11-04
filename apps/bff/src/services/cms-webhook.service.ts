import { CmsWebhookEvent, ICmsAdapter } from "@pithcharge/cms-adapters";
import { db, Prisma } from "@pithcharge/db";
import {
  money,
  getOrCreateLedgerAccount,
  postBalancedLedgerTransaction,
  releaseWalletReservation,
} from "./financial.service";
import { createUserNotification } from "./notification.service";
import {
  computeCharge,
  legacySnapshot,
  readSnapshot,
} from "./rate-engine.service";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function field(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

function numericField(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : NaN;
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return undefined;
}

function transactionId(payload: Record<string, unknown>) {
  const nested = record(payload.transactionInfo);
  return (
    field(payload, "transactionId", "transaction_id") ??
    (nested ? field(nested, "transactionId", "transaction_id") : undefined)
  );
}

function tokenValue(payload: Record<string, unknown>) {
  const token = record(payload.idToken);
  return (
    field(payload, "idTokenValue", "idTag", "idToken") ??
    (token ? field(token, "idToken", "idTag") : undefined)
  );
}

async function findSessionForStart(
  event: CmsWebhookEvent,
  payload: Record<string, unknown>,
) {
  const evseId = numericField(payload, "evseId");
  const connectorId = numericField(payload, "connectorId");
  const idToken = tokenValue(payload);
  const candidates = await db.chargingSession.findMany({
    where: {
      stationId: event.stationId,
      status: "PENDING",
      ...(evseId === undefined ? {} : { evseId }),
      ...(connectorId === undefined ? {} : { connectorId }),
      ...(idToken ? { idTokenValue: idToken } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? "No pending charging session matches the CitrineOS transaction-start event."
        : "CitrineOS transaction-start event matches multiple pending charging sessions.",
    );
  }
  return candidates[0]!;
}

async function processTransactionStarted(
  event: CmsWebhookEvent,
  payload: Record<string, unknown>,
) {
  const id = transactionId(payload);
  if (!id)
    throw new Error("Transaction-start event is missing its transaction ID.");
  let session = await db.chargingSession.findUnique({
    where: { ocppTransactionId: id },
  });
  if (!session) {
    session = await findSessionForStart(event, payload);
    const meterStart = numericField(payload, "meterStartKwh", "meterKwh");
    session = await db.chargingSession.update({
      where: { id: session.id },
      data: {
        ocppTransactionId: id,
        status: "ACTIVE",
        startTime: new Date(event.timestamp),
        ...(meterStart === undefined
          ? {}
          : { startMeterKwh: meterStart, lastMeterKwh: meterStart }),
      },
    });
    await db.auditLog.create({
      data: {
        actorId: session.userId,
        organizationId: session.organizationId,
        action: "charging.session.started",
        targetType: "ChargingSession",
        targetId: session.id,
        metadata: { transactionId: id, stationId: event.stationId },
      },
    });
  }
  await createUserNotification({
    userId: session.userId,
    organizationId: session.organizationId ?? undefined,
    eventKey: `session-started:${session.id}`,
    title: "Charging session started",
    body: `Your charging session at charger ${event.stationId} is now active.`,
    category: "sessionUpdates",
    data: {
      sessionId: session.id,
      stationId: event.stationId,
      transactionId: id,
    },
  });
}

async function processMeterValues(
  event: CmsWebhookEvent,
  payload: Record<string, unknown>,
) {
  const id = transactionId(payload);
  const meter = numericField(payload, "currentMeterKwh", "meterKwh");
  if (!id || meter === undefined) {
    throw new Error(
      "Meter-values event requires transactionId and currentMeterKwh or meterKwh.",
    );
  }
  const session = await db.chargingSession.findFirst({
    where: { ocppTransactionId: id, stationId: event.stationId },
  });
  if (!session)
    throw new Error(
      "Meter-values event does not match a persisted charging session.",
    );
  if (session.status !== "ACTIVE") return;

  const lastMeterKwh = Math.max(session.lastMeterKwh, meter);
  const totalKwh = Math.max(0, lastMeterKwh - session.startMeterKwh);
  await db.chargingSession.update({
    where: { id: session.id },
    data: { lastMeterKwh, totalKwh },
  });
}

// Sessions without an organization wallet (public or anonymous charging) are free.
async function completeUnbilledSession(
  session: {
    id: string;
    userId: string;
    lastMeterKwh: number;
    startMeterKwh: number;
    organizationId: string | null;
    stationId: string;
    startTime: Date;
    pricingSnapshot: Prisma.JsonValue | null;
  },
  event: CmsWebhookEvent,
  payload: Record<string, unknown>,
  id: string,
) {
  const meterStop = numericField(
    payload,
    "meterStopKwh",
    "currentMeterKwh",
    "meterKwh",
  );
  const totalKwh =
    numericField(payload, "totalKwh", "energyKwh") ??
    Math.max(0, (meterStop ?? session.lastMeterKwh) - session.startMeterKwh);
  const snapshot = readSnapshot(session.pricingSnapshot);
  const endTime = new Date(event.timestamp);
  // Public sessions are not debited; the cost is recorded for the user's information.
  const totalCost = snapshot
    ? computeCharge({
        snapshot,
        stationId: session.stationId,
        startTime: session.startTime,
        endTime,
        totalKwh,
        idleMinutes: numericField(payload, "idleMinutes") ?? 0,
      }).total
    : undefined;
  const updated = await db.chargingSession.updateMany({
    where: { id: session.id, status: { not: "COMPLETED" } },
    data: {
      status: "COMPLETED",
      endTime,
      totalKwh,
      ...(totalCost ? { totalCost } : {}),
      lastMeterKwh: meterStop ?? session.lastMeterKwh,
    },
  });
  if (updated.count === 0) return;
  await createUserNotification({
    userId: session.userId,
    organizationId: session.organizationId ?? undefined,
    eventKey: `session-ended:${session.id}`,
    title: "Charging session completed",
    body: `Your session delivered ${totalKwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh.`,
    category: "sessionUpdates",
    data: { sessionId: session.id, transactionId: id, totalKwh },
  });
}

async function processTransactionEnded(
  event: CmsWebhookEvent,
  payload: Record<string, unknown>,
) {
  const id = transactionId(payload);
  if (!id)
    throw new Error("Transaction-end event is missing its transaction ID.");
  const session = await db.chargingSession.findFirst({
    where: { ocppTransactionId: id, stationId: event.stationId },
    include: { paymentHold: true },
  });
  if (!session)
    throw new Error(
      "Transaction-end event does not match a persisted charging session.",
    );
  if (session.status === "COMPLETED") return;
  if (!session.walletId || !session.organizationId) {
    await completeUnbilledSession(session, event, payload, id);
    return;
  }

  const policy = await db.billingPolicy.findUnique({
    where: { organizationId: session.organizationId },
  });
  if (!policy)
    throw new Error(
      "Organization billing policy is missing for the ended session.",
    );

  const meterStop = numericField(
    payload,
    "meterStopKwh",
    "currentMeterKwh",
    "meterKwh",
  );
  const reportedEnergy = numericField(payload, "totalKwh", "energyKwh");
  const totalKwh =
    reportedEnergy ??
    Math.max(0, (meterStop ?? session.lastMeterKwh) - session.startMeterKwh);
  const idleMinutes = numericField(payload, "idleMinutes") ?? 0;
  const charge = computeCharge({
    snapshot:
      readSnapshot(session.pricingSnapshot) ?? legacySnapshot(session, policy),
    stationId: session.stationId,
    startTime: session.startTime,
    endTime: new Date(event.timestamp),
    totalKwh,
    idleMinutes,
  });
  const totalCost = charge.total;
  const allowNegativeBalance =
    session.allowNegativeBalance ??
    (policy.billingMode === "POSTPAID" && policy.allowNegativeBalance);
  const negativeBalanceLimit =
    session.negativeBalanceLimit ?? policy.negativeBalanceLimit;
  const holdAmount = session.paymentHold?.amount ?? new Prisma.Decimal(0);

  const settled = await db.$transaction(
    async (transaction: Prisma.TransactionClient) => {
      const currentSession =
        await transaction.chargingSession.findUniqueOrThrow({
          where: { id: session.id },
        });
      if (currentSession.status === "COMPLETED") {
        const currentWallet = await transaction.wallet.findUniqueOrThrow({
          where: { id: session.walletId! },
        });
        return {
          duplicate: true,
          wallet: currentWallet,
          currentAvailable: currentWallet.balance.minus(
            currentWallet.reservedBalance,
          ),
        };
      }

      let walletCharge = new Prisma.Decimal(0);
      let wallet = await transaction.wallet.findUniqueOrThrow({
        where: { id: session.walletId! },
      });
      if (session.paymentHold) {
        const locks = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE
      `;
        if (locks.length !== 1)
          throw new Error("Unable to lock the session wallet for settlement.");
        wallet = await transaction.wallet.findUniqueOrThrow({
          where: { id: wallet.id },
        });
        if (wallet.reservedBalance.lt(holdAmount)) {
          throw new Error(
            "Session wallet reservation is smaller than the reserved payment hold.",
          );
        }

        // The charge was incurred, so the wallet is debited in full even if that takes it negative.
        walletCharge = totalCost;
        const receivable = new Prisma.Decimal(0);

        if (holdAmount.gt(0)) {
          await releaseWalletReservation(transaction, wallet.id, holdAmount);
        }
        if (walletCharge.gt(0)) {
          await transaction.wallet.update({
            where: { id: wallet.id },
            data: { balance: { decrement: walletCharge } },
          });
        }

        const ledgerOrganizationId = session.organizationId;
        if (totalCost.gt(0) && ledgerOrganizationId) {
          const walletAccount = await getOrCreateLedgerAccount(transaction, {
            organizationId: ledgerOrganizationId,
            currency: session.currency,
            code: `WALLET_${wallet.id}`,
            type: "WALLET_LIABILITY",
            walletId: wallet.id,
          });
          const revenueAccount = await getOrCreateLedgerAccount(transaction, {
            organizationId: ledgerOrganizationId,
            currency: session.currency,
            code: "CHARGING_REVENUE",
            type: "CHARGING_REVENUE",
          });
          const entries: Array<{
            accountId: string;
            direction: "DEBIT" | "CREDIT";
            amount: Prisma.Decimal;
          }> = [];
          if (walletCharge.gt(0)) {
            entries.push({
              accountId: walletAccount.id,
              direction: "DEBIT",
              amount: walletCharge,
            });
          }
          if (receivable.gt(0)) {
            const receivableAccount = await getOrCreateLedgerAccount(
              transaction,
              {
                organizationId: ledgerOrganizationId,
                currency: session.currency,
                code: "ACCOUNTS_RECEIVABLE",
                type: "ACCOUNTS_RECEIVABLE",
              },
            );
            entries.push({
              accountId: receivableAccount.id,
              direction: "DEBIT",
              amount: receivable,
            });
          }
          entries.push({
            accountId: revenueAccount.id,
            direction: "CREDIT",
            amount: totalCost,
          });
          await postBalancedLedgerTransaction(transaction, {
            idempotencyKey: `session-settlement:${session.id}`,
            organizationId: ledgerOrganizationId,
            referenceType: "CHARGING_SESSION",
            referenceId: session.id,
            description: `Charging session ${id}`,
            currency: session.currency,
            entries,
          });
        }

        if (session.paymentHold) {
          await transaction.paymentHold.update({
            where: { id: session.paymentHold.id },
            data: {
              status: walletCharge.gt(0) ? "CAPTURED" : "RELEASED",
              capturedAmount: walletCharge,
            },
          });
        }
        const updatedWallet = await transaction.wallet.findUniqueOrThrow({
          where: { id: wallet.id },
        });
        await transaction.chargingSession.update({
          where: { id: session.id },
          data: {
            status: "COMPLETED",
            endTime: new Date(event.timestamp),
            totalKwh,
            totalCost,
            lastMeterKwh:
              meterStop ??
              Math.max(session.lastMeterKwh, session.startMeterKwh + totalKwh),
            billedAt: new Date(),
            receivableAmount: receivable,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: session.userId,
            organizationId: session.organizationId,
            action: "billing.session.settled",
            targetType: "ChargingSession",
            targetId: session.id,
            metadata: {
              transactionId: id,
              totalKwh,
              totalCost: totalCost.toString(),
              walletCharge: walletCharge.toString(),
              receivable: receivable.toString(),
              currency: session.currency,
            },
          },
        });
        return {
          duplicate: false,
          wallet: updatedWallet,
          currentAvailable: updatedWallet.balance.minus(
            updatedWallet.reservedBalance,
          ),
        };
      }

      await transaction.chargingSession.update({
        where: { id: session.id },
        data: {
          status: "COMPLETED",
          endTime: new Date(event.timestamp),
          totalKwh,
          totalCost,
          lastMeterKwh: meterStop ?? session.lastMeterKwh,
          billedAt: new Date(),
        },
      });
      return { duplicate: false, wallet, currentAvailable: null };
    },
  );

  await createUserNotification({
    userId: session.userId,
    organizationId: session.organizationId,
    eventKey: `session-ended:${session.id}`,
    title: "Charging session completed",
    body: `Your session used ${totalKwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh and cost  ${Number(totalCost).toLocaleString(
      undefined,
      {
        style: "currency",
        currency: session.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    )}.`,
    category: "sessionUpdates",
    data: {
      sessionId: session.id,
      transactionId: id,
      totalKwh,
      totalCost: totalCost.toString(),
    },
  });
  if (totalCost.gt(0)) {
    await createUserNotification({
      userId: session.userId,
      organizationId: session.organizationId,
      eventKey: `session-payment:${session.id}`,
      title: "Charging session billed",
      body: `${Number(totalCost).toLocaleString(undefined, { style: "currency", currency: session.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })} was billed under your organization's charging policy.`,
      category: "paymentUpdates",
      data: {
        sessionId: session.id,
        totalCost: totalCost.toString(),
        currency: session.currency,
      },
    });
  }
  if (
    settled.wallet &&
    settled.currentAvailable &&
    policy.lowCreditThreshold &&
    settled.currentAvailable.lte(policy.lowCreditThreshold)
  ) {
    const recipients: Array<{ userId: string }> =
      policy.walletSharingMode === "SHARED"
        ? await db.member.findMany({
            where: { organizationId: session.organizationId },
            select: { userId: true },
          })
        : await db.member.findMany({
            where: {
              organizationId: session.organizationId,
              billingWalletId: session.walletId,
            },
            select: { userId: true },
          });
    const recipientIds = new Set(
      recipients.map((member: { userId: string }) => member.userId),
    );
    if (typeof settled.wallet.userId === "string")
      recipientIds.add(settled.wallet.userId);
    await Promise.all(
      [...recipientIds].map((userId) =>
        createUserNotification({
          userId,
          organizationId: session.organizationId!,
          eventKey: `low-credit:${session.walletId}:${new Date().toISOString().slice(0, 10)}`,
          title: "Wallet balance is low",
          body: `The wallet balance is at or below ${Number(policy.lowCreditThreshold).toLocaleString(undefined, { style: "currency", currency: session.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
          category: "lowCreditUpdates",
          data: {
            walletId: session.walletId,
            threshold: policy.lowCreditThreshold!.toString(),
          },
        }),
      ),
    );
  }
}

export async function processCitrineosWebhook(
  eventInput: unknown,
  cms: ICmsAdapter,
) {
  const eventRecord = record(eventInput);
  if (!eventRecord)
    throw new Error("CitrineOS webhook outbox payload is invalid.");
  const event = eventRecord as unknown as CmsWebhookEvent;
  const payload = record(event.payload);
  if (!payload) throw new Error("CitrineOS webhook payload is invalid.");

  switch (event.eventType) {
    case "TransactionStarted":
      await processTransactionStarted(event, payload);
      return;
    case "MeterValues":
      await processMeterValues(event, payload);
      return;
    case "TransactionEnded":
      await processTransactionEnded(event, payload);
      return;
    case "Heartbeat":
      return;
    case "StatusNotification":
      await db.auditLog.create({
        data: {
          action: "charger.status.updated",
          targetType: "ChargingStation",
          targetId: event.stationId,
          metadata: eventRecord as Prisma.InputJsonValue,
        },
      });
      return;
    default:
      await cms.getStationStatus(event.stationId);
      throw new Error(
        `Unsupported CitrineOS event type "${String(event.eventType)}".`,
      );
  }
}
