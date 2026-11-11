'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { BrowserQRCodeSvgWriter } from '@zxing/browser';
import {
  ArrowLeft,
  BatteryCharging,
  Download,
  MapPin,
  PlugZap,
  QrCode,
  Wifi,
} from 'lucide-react';
import {
  useStationDetails,
  useHubDetails,
  useStationStatus,
  useStopSession,
  useMyActiveSessions,
  useUnlockConnector,
} from '@/api/cmsApi';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActionLoadingOverlay } from '@/components/action-loading-overlay';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { useSession } from '@/lib/auth-client';

export default function StationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: station, isLoading, isError } = useStationDetails(id);
  const { data: liveStatus } = useStationStatus(id);
  const { data: session } = useSession();

  const stopSession = useStopSession();
  const unlockConnector = useUnlockConnector();
  const { data: mySessions } = useMyActiveSessions(id);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [stopTarget, setStopTarget] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState('');
  const isPlatformAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';

  const stationLabel = station?.label || station?.ocppConnectionName || station?.id || id;
  const { data: hub, isLoading: hubLoading } = useHubDetails(station?.hubId ?? '');
  const hubAddress = hub
    ? [hub.location.address, hub.location.city, hub.location.state].filter(Boolean).join(', ')
    : '';

  const generateStationQr = () => {
    const stationUrl = `${window.location.origin}/stations/${encodeURIComponent(id)}`;
    const svg = new BrowserQRCodeSvgWriter().write(stationUrl, 320, 320);
    setQrSvg(new XMLSerializer().serializeToString(svg));
  };

  const downloadStationQr = () => {
    if (!qrSvg || !station) return;
    const url = URL.createObjectURL(new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${station.id}-qr.svg`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-5xl border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading station details...
        </div>
      </div>
    );
  }

  if (isError || !station) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-xl space-y-4 border bg-card p-8 text-center">
          <p className="text-sm text-destructive">Station "{id}" was not found or could not be loaded.</p>
          <Button render={<Link href="/hubs" />} variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Hubs
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      {actionLoading && (
        <ActionLoadingOverlay
          message={actionLoading.startsWith('unlock-') ? 'Unlocking connector…' : 'Stopping charging session…'}
        />
      )}
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant={station.isOnline ? 'default' : 'secondary'}>
            {station.isOnline ? 'Online' : 'Offline'}
          </Badge>
          {isPlatformAdmin && (
            <Button type="button" variant="outline" size="sm" onClick={generateStationQr} className="gap-2">
              <QrCode className="size-4" />
              Generate station QR
            </Button>
          )}
        </div>

        {isPlatformAdmin && qrSvg && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-4 sm:flex-row">
              <div
                className="h-40 w-40 shrink-0 bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
                aria-label={`QR code for station ${station.id}`}
              />
              <div className="space-y-2">
                <p className="font-medium">Station QR code</p>
                <p className="max-w-md break-all text-sm text-muted-foreground">
                  Scanning opens this station’s details so a driver can choose an available connector.
                </p>
                <Button type="button" onClick={downloadStationQr} className="gap-2">
                  <Download className="size-4" />
                  Download SVG
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <CardTitle className="text-3xl font-semibold tracking-tight">{stationLabel}</CardTitle>
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="border bg-muted/30 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Wifi className={`h-3.5 w-3.5 ${station.isOnline ? 'text-green-500' : 'text-red-500'}`} />
                Status
              </div>
              <div className="text-lg font-semibold text-foreground">{station.isOnline ? 'Available' : 'Unavailable'}</div>
            </div>

            <div className="border bg-muted/30 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                Hub
              </div>
              <div className="text-lg font-semibold text-foreground">{hub?.name || hubAddress || (hubLoading ? 'Loading…' : 'Not set')}</div>
              {hub?.name && hubAddress && <div className="mt-1 text-sm text-muted-foreground">{hubAddress}</div>}
            </div>

            <div className=" border bg-muted/30 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <BatteryCharging className="h-3.5 w-3.5" />
                OCPP version
              </div>
              <div className="text-lg font-semibold text-foreground">{station.ocppVersion}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">EVSE overview</CardTitle>
            <CardDescription>
              Live station status and connector details for the selected charging point.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {station.evses.map((evse) => {
              const liveEvse = liveStatus?.evses.find((entry) => entry.evseId === evse.evseId);
              const currentStatus = liveEvse?.status || evse.status;
              const activeTx = liveEvse?.activeTransactionId || evse.activeTransactionId;
              const mySession = mySessions?.find((entry) => entry.evseId === evse.evseId);

              return (
                <div key={evse.evseId} className=" border bg-muted/20 p-4 shadow-sm">
                  <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <PlugZap className="h-4 w-4 text-primary" />
                      <div className="font-medium text-foreground">
                        {evse.physicalReference ? `EVSE ${evse.physicalReference}` : `EVSE #${evse.evseId}`}
                        {evse.physicalReference && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">#{evse.evseId}</span>
                        )}
                      </div>
                    </div>

                    <Badge variant={currentStatus === 'Available' ? 'default' : 'secondary'}>
                      {currentStatus || 'Unknown'}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {evse.connectors.map((connector) => (
                      <div key={connector.connectorId} className="border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-foreground">
                              Connector #{connector.connectorId}
                            </div>
                            <div className="text-xs text-muted-foreground">{connector.type}</div>
                          </div>
                          <Badge variant="outline">{connector.status}</Badge>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{connector.maxPowerKw} kW</span>
                          <span>
                            {connector.tariffPerKwh ? `${connector.tariffPerKwh} ${connector.currency ?? ''}/kWh` : 'No tariff'}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="flex gap-2">
                            <Button
                              render={<Link href={`/stations/${id}/connectors/${connector.connectorId}?evseId=${evse.evseId}`}
                              className="text-primary-foreground"
                              />}
                              variant="default"
                              className="gap-2"
                            >
                              Use connector
                            </Button>
                          </div>

                          <div>
                            {connector.status === 'Reserved' || connector.status === 'Unavailable' ? (
                              <Button
                                variant="outline"
                                className="gap-2"
                                onClick={() => {
                                  setActionLoading(`unlock-${evse.evseId}-${connector.connectorId}`);
                                  unlockConnector.mutate(
                                    { stationId: id, evseId: evse.evseId, connectorId: connector.connectorId },
                                    {
                                      onError: (err) => {
                                        toast.add({ type: 'error', description: err.message || 'Failed to unlock connector.' });
                                        setActionLoading(null);
                                      },
                                      onSuccess: () => {
                                        toast.add({ type: 'success', description: 'Unlock command sent.' });
                                        setActionLoading(null);
                                      },
                                    }
                                  );
                                }}
                                disabled={actionLoading !== null}
                              >
                                Unlock
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {mySession ? (
                      <>
                        <Button render={<Link href={`/sessions/${mySession.id}`} />} variant="default">
                          View your session
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => setStopTarget(mySession.id)}
                          disabled={actionLoading !== null || mySession.status !== 'ACTIVE'}
                        >
                          Stop charging
                        </Button>
                      </>
                    ) : activeTx ? (
                      <div className="border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                        In use by another driver
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={stopTarget !== null}
        title="Stop charging?"
        description="The charger will end your session and your vehicle will stop receiving power."
        confirmLabel="Stop charging"
        destructive
        pending={stopSession.isPending}
        onCancel={() => setStopTarget(null)}
        onConfirm={() => {
          if (!stopTarget) return;
          setActionLoading('stop');
          stopSession.mutate(
            { sessionId: stopTarget },
            {
              onError: (err) => toast.add({ type: 'error', description: err.message || 'Failed to stop charging.' }),
              onSuccess: () => toast.add({ type: 'success', description: 'Stop command sent.' }),
              onSettled: () => {
                setActionLoading(null);
                setStopTarget(null);
              },
            },
          );
        }}
      />
    </div>
  );
}
