"use client";

import React, { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PlugZap } from "lucide-react";
import {
  useStationDetails,
  useStationStatus,
  useRemoteStart,
  useStopSession,
  useMyActiveSessions,
  useUnlockConnector,
} from "@/api/cmsApi";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { FundWalletForm } from "@/components/billing/fund-wallet";
import { ActionLoadingOverlay } from "@/components/action-loading-overlay";
import { toast } from "@/components/ui/toast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export default function ConnectorPage({
  params,
}: {
  params: Promise<{ id: string; connectorId: string }>;
}) {
  const { id: stationId, connectorId } = use(params);
  const router = useRouter();

  const { data: station, isLoading } = useStationDetails(stationId);
  const { data: liveStatus } = useStationStatus(stationId);

  const remoteStart = useRemoteStart();
  const stopSession = useStopSession();
  const unlockConnector = useUnlockConnector();
  const { data: mySessions } = useMyActiveSessions(stationId);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [needsFunds, setNeedsFunds] = useState<"topup" | "admin" | null>(null);

  const found = (() => {
    if (!station) return null;
    for (const evse of station.evses) {
      for (const connector of evse.connectors) {
        if (String(connector.connectorId) === String(connectorId)) {
          return { evse, connector };
        }
      }
    }
    return null;
  })();

  if (isLoading || !station) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-3xl border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading connector...
        </div>
      </div>
    );
  }

  if (!found) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-3xl space-y-4 border bg-card p-8 text-center">
          <p className="text-sm text-destructive">
            Connector "{connectorId}" was not found on station "{stationId}".
          </p>
          <Button
            render={<Link href={`/stations/${stationId}`} />}
            variant="outline"
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  const { evse, connector } = found;
  const currency = connector.currency ?? "USD";
  const actionMessage =
    actionLoading === "start"
      ? "Starting charging session…"
      : actionLoading === "stop"
        ? "Stopping charging session…"
        : actionLoading === "unlock"
          ? "Unlocking connector…"
          : "";

  const liveEvse = liveStatus?.evses.find((e) => e.evseId === evse.evseId);
  const liveConnector = liveEvse?.connectors?.find(
    (c) => String(c.connectorId) === String(connector.connectorId),
  );
  const connectorStatus = liveConnector?.status ?? connector.status;
  const isCharging =
    liveEvse?.status === "Charging" || connectorStatus === "Charging";
  const mySession = mySessions?.find(
    (s) => s.evseId === evse.evseId && s.connectorId === connector.connectorId,
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      {actionLoading && <ActionLoadingOverlay message={actionMessage} />}
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PlugZap className="h-6 w-6 text-primary" />
                <div>
                  <CardTitle>Connector #{connector.connectorId}</CardTitle>
                  <CardDescription className="text-sm">
                    {evse.evseId ? `EVSE #${evse.evseId}` : ""}
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="space-y-4">
              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">Type</div>
                <div className="text-sm font-medium">{connector.type}</div>
              </div>

              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">
                  Published station tariff
                </div>
                <div className="text-sm font-medium">
                  {connector.tariffPerKwh
                    ? `${connector.tariffPerKwh} ${currency}/kWh`
                    : "No tariff set"}
                </div>
              </div>

              <div className="border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                Charges follow the effective rate for this connector. Paid
                chargers require funds in your wallet; the actual cost is
                deducted after charging. Free chargers need no balance.
              </div>

              {needsFunds === "topup" && (
                <div className="space-y-3 border border-border p-3">
                  <p className="text-sm font-medium">
                    Top up your wallet to start charging
                  </p>
                  <FundWalletForm
                    currency={currency}
                    pendingStart={{
                      stationId,
                      evseId: evse.evseId,
                      connectorId: connector.connectorId,
                    }}
                  />
                </div>
              )}
              {needsFunds === "admin" && (
                <div className="border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  Your organization wallet does not have enough balance for this
                  session. Contact your organization administrator to top up the
                  wallet.
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    onClick={() => {
                      setActionLoading("start");
                      remoteStart.mutate(
                        {
                          stationId,
                          evseId: evse.evseId,
                          connectorId: connector.connectorId,
                          limitKw: connector.maxPowerKw,
                          idempotencyKey: crypto.randomUUID(),
                        },
                        {
                          onError: (err) => {
                            const code = (err as { code?: string }).code;
                            if (code === "WALLET_TOPUP_REQUIRED")
                              setNeedsFunds("topup");
                            else if (code === "INSUFFICIENT_WALLET_BALANCE")
                              setNeedsFunds("admin");
                            toast.add({
                              type: "error",
                              description:
                                err.message || "Failed to start charging.",
                            });
                            setActionLoading(null);
                          },
                          onSuccess: (data) => {
                            toast.add({
                              type: "success",
                              description: "Charging start command sent.",
                            });
                            if (data.sessionId) {
                              router.push(`/sessions/${data.sessionId}`);
                              return;
                            }
                            setActionLoading(null);
                          },
                        },
                      );
                    }}
                    disabled={
                      actionLoading !== null ||
                      isCharging ||
                      !["Available", "Occupied"].includes(connectorStatus)
                    }
                  >
                    {actionLoading === "start"
                      ? "Starting…"
                      : isCharging
                        ? "Charging..."
                        : "Start charging"}
                  </Button>

                  <Button
                    variant="destructive"
                    onClick={() => setConfirmStop(true)}
                    disabled={actionLoading !== null || !mySession}
                  >
                    {actionLoading === "stop" ? "Stopping…" : "Stop charging"}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => {
                      setActionLoading("unlock");
                      unlockConnector.mutate(
                        {
                          stationId,
                          evseId: evse.evseId,
                          connectorId: connector.connectorId,
                        },
                        {
                          onError: (err) => {
                            toast.add({
                              type: "error",
                              description:
                                err.message || "Failed to unlock connector.",
                            });
                            setActionLoading(null);
                          },
                          onSuccess: () => {
                            toast.add({
                              type: "success",
                              description: "Unlock command sent.",
                            });
                            setActionLoading(null);
                          },
                        },
                      );
                    }}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "unlock" ? "Unlocking…" : "Unlock"}
                  </Button>
                </div>

                <div className="mt-4">
                  <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-400 ${isCharging ? "animate-[progress_5s_linear_infinite]" : ""}`}
                      style={{ width: isCharging ? "100%" : "0%" }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {isCharging ? "Charging in progress" : "Not charging"}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={confirmStop}
        title="Stop charging?"
        description="The charger will end your session and your vehicle will stop receiving power."
        confirmLabel="Stop charging"
        destructive
        pending={stopSession.isPending}
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => {
          if (!mySession) return;
          setActionLoading("stop");
          stopSession.mutate(
            { sessionId: mySession.id },
            {
              onError: (err) =>
                toast.add({
                  type: "error",
                  description: err.message || "Failed to stop charging.",
                }),
              onSuccess: () =>
                toast.add({
                  type: "success",
                  description: "Stop command sent.",
                }),
              onSettled: () => {
                setActionLoading(null);
                setConfirmStop(false);
              },
            },
          );
        }}
      />
    </div>
  );
}
