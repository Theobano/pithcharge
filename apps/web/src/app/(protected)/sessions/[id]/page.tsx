'use client';

import { use, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  BatteryCharging,
  CircleAlert,
  CircleCheck,
  Clock3,
  Gauge,
  LoaderCircle,
  PlugZap,
  Receipt,
  Square,
  Zap,
} from 'lucide-react';
import { useSessionDetails, useStopSession, type SessionDetails } from '@/api/cmsApi';
import { ActionLoadingOverlay } from '@/components/action-loading-overlay';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { currentRateLabel, formatDuration, formatMoney } from '@/lib/utils';
import { useNow } from '@/hooks/use-now';

const STATUS_STYLE: Record<SessionDetails['session']['status'], { label: string; className: string }> = {
  PENDING: { label: 'Starting', className: 'border-amber-500/40 bg-amber-500/10 text-amber-600' },
  ACTIVE: { label: 'Charging', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' },
  COMPLETED: { label: 'Completed', className: 'border-border bg-muted text-muted-foreground' },
  FAILED: { label: 'Failed', className: 'border-destructive/40 bg-destructive/10 text-destructive' },
};





export default function SessionDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useSessionDetails(id);
  const stopSession = useStopSession();
  const [confirmingStop, setConfirmingStop] = useState(false);

  const live = data?.session.status === 'PENDING' || data?.session.status === 'ACTIVE';
  const now = useNow(live);

  if (isLoading) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Loading session…</div>;
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6 text-center">
        <CircleAlert className="mx-auto size-8 text-destructive" />
        <p className="text-sm text-destructive">{error?.message ?? 'Session not found.'}</p>
        <Button render={<Link href="/sessions" />} variant="outline">Back to sessions</Button>
      </div>
    );
  }

  const { session, telemetry, canControl } = data;
  const style = STATUS_STYLE[session.status];
  const started = new Date(session.startTime).getTime();
  const ended = session.endTime ? new Date(session.endTime).getTime() : now;
  const durationSeconds = (ended - started) / 1000;
  const hasTransaction = Boolean(session.transactionId);
  const canStop = canControl && live;

  const handleStop = () => {
    stopSession.mutate(
      { sessionId: session.id },
      {
        onSuccess: () => toast.add({ type: 'success', description: 'Stop command sent. Finishing your session…' }),
        onError: (err) => toast.add({ type: 'error', description: err.message || 'Failed to stop charging.' }),
        onSettled: () => setConfirmingStop(false),
      },
    );
  };

  const cost = session.status === 'COMPLETED' ? session.totalCost : session.estimatedCost;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pt-0">
      {stopSession.isPending && <ActionLoadingOverlay message="Stopping charging session…" />}

      <div className="flex justify-end">
        <Badge variant="outline" className={`gap-2 ${style.className}`}>
          {session.status === 'ACTIVE' && <span className="size-2 animate-pulse rounded-full bg-emerald-500" />}
          {style.label}
        </Badge>
      </div>

      <Card className="border-border/70 bg-card/80">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center bg-primary/10 text-primary">
              <PlugZap className="size-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-lg" >
                <Link href={`/stations/${session.stationId}`} className="underline">
                  Charger {session.stationId}
                </Link>
              </CardTitle>
              <CardDescription>
                EVSE {session.evseId} · Connector {session.connectorId} · Started{' '}
                {new Date(session.startTime).toLocaleString()}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <StatusBanner session={session} hasTransaction={hasTransaction} />

          <div className="flex flex-col items-center gap-1 py-2 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Energy delivered</p>
            <p className="text-5xl font-semibold tabular-nums tracking-tight">
              {session.totalKwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="ml-2 text-xl font-normal text-muted-foreground">kWh</span>
            </p>
            {telemetry?.socPercent !== undefined && <SocBar percent={telemetry.socPercent} />}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric icon={<Clock3 className="size-4" />} label="Duration" value={formatDuration(durationSeconds)} />
            <Metric
              icon={<Zap className="size-4" />}
              label="Power"
              value={telemetry?.powerKw !== undefined ? `${telemetry.powerKw.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW` : '—'}
            />
            {!session.costHidden && (
              <Metric
                icon={<Receipt className="size-4" />}
                label={session.status === 'COMPLETED' ? 'Total cost' : 'Estimated cost'}
                value={formatMoney(session.currency, cost)}
              />
            )}
            <Metric
              icon={<Gauge className="size-4" />}
              label="Voltage"
              value={telemetry?.voltage !== undefined ? `${telemetry.voltage.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} V` : '—'}
            />
            <Metric
              icon={<BatteryCharging className="size-4" />}
              label="Current"
              value={telemetry?.currentAmps !== undefined ? `${telemetry.currentAmps.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} A` : '—'}
            />
            {!session.costHidden && (
              <Metric
                icon={<Receipt className="size-4" />}
                label={session.pricing?.currentRule ? `Rate · ${session.pricing.currentRule}` : 'Rate'}
                value={currentRateLabel(session)}
              />
            )}
          </div>

          {canStop && (
            <div className="space-y-2 border-t border-border pt-4">
              {confirmingStop ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="destructive"
                    className="flex-1 gap-2"
                    onClick={handleStop}
                    disabled={stopSession.isPending}
                  >
                    <Square className="size-4" />
                    Yes, stop charging
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setConfirmingStop(false)}
                    disabled={stopSession.isPending}
                  >
                    Keep charging
                  </Button>
                </div>
              ) : (
                <Button
                  variant="destructive"
                  className="w-full gap-2 py-5"
                  onClick={() => setConfirmingStop(true)}
                  disabled={!hasTransaction || stopSession.isPending}
                >
                  <Square className="size-4" />
                  Stop charging
                </Button>
              )}
              {!hasTransaction && (
                <p className="text-center text-xs text-muted-foreground">
                  Stopping becomes available once the charger starts the session.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBanner({
  session,
  hasTransaction,
}: {
  session: SessionDetails['session'];
  hasTransaction: boolean;
}) {
  if (session.status === 'PENDING') {
    return (
      <Banner tone="amber" icon={<LoaderCircle className="size-5 animate-spin" />}>
        {hasTransaction
          ? 'Charger accepted the request. Charging is about to begin.'
          : 'Waiting for the charger. Plug in your vehicle to begin charging.'}
      </Banner>
    );
  }
  if (session.status === 'COMPLETED') {
    return (
      <Banner tone="emerald" icon={<CircleCheck className="size-5" />}>
        Session complete{session.endTime ? ` · ended ${new Date(session.endTime).toLocaleString()}` : ''}.
      </Banner>
    );
  }
  if (session.status === 'FAILED') {
    return (
      <Banner tone="rose" icon={<CircleAlert className="size-5" />}>
        This session could not be completed.
      </Banner>
    );
  }
  return null;
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'amber' | 'emerald' | 'rose';
  icon: ReactNode;
  children: ReactNode;
}) {
  const tones = {
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    rose: 'border-destructive/30 bg-destructive/10 text-destructive',
  };
  return (
    <div className={`flex items-center gap-3 border p-3 text-sm ${tones[tone]}`} role="status">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function SocBar({ percent }: { percent: number }) {
  const value = Math.min(100, Math.max(0, percent));
  return (
    <div className="mt-3 w-full max-w-xs space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Battery</span>
        <span className="tabular-nums">{value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden bg-muted"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="space-y-1 border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
