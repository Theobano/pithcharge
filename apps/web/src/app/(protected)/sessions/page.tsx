"use client";

import { toApiError } from "@/lib/api/error";
import { bffUrl } from "@/lib/api/base-url";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BatteryCharging,
  Clock3,
  CreditCard,
  MapPin,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";
import { formatMoney } from "@/lib/utils";

type ChargingSession = {
  id: string;
  stationId: string;
  evseId: number;
  connectorId: number;
  status: string;
  startTime: string;
  endTime: string | null;
  totalKwh: number;
  totalCost: number | string | null;
  currency: string;
};

const apiUrl = { toString: bffUrl };

function durationMinutes(session: ChargingSession) {
  const end = session.endTime
    ? new Date(session.endTime).getTime()
    : Date.now();
  return Math.max(
    0,
    Math.round((end - new Date(session.startTime).getTime()) / 60_000),
  );
}

export default function SessionsPage() {
  const { data: session } = useSession();
  const [sessions, setSessions] = useState<ChargingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user || session.user.isAnonymous) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/users/sessions`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw await toApiError(response, "Unable to load charging history.");
        return (await response.json()) as { data: ChargingSession[] };
      })
      .then((result) => {
        setSessions(result.data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load charging history.",
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [session?.user]);

  const totalEnergy = useMemo(
    () => sessions.reduce((sum, item) => sum + item.totalKwh, 0),
    [sessions],
  );
  const averageMinutes = useMemo(() => {
    if (sessions.length === 0) return 0;
    return Math.round(
      sessions.reduce((sum, item) => sum + durationMinutes(item), 0) /
        sessions.length,
    );
  }, [sessions]);

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex justify-end">
        <Button
          render={<Link href="/stations" />}
          variant="outline"
          className="w-fit gap-2"
        >
          Find a charger
          <ArrowRight className="size-4" />
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Total sessions"
          icon={<Zap className="size-4" />}
          value={sessions.length.toString()}
          detail="Recent account history"
        />
        <MetricCard
          title="Energy added"
          icon={<BatteryCharging className="size-4" />}
          value={`${totalEnergy.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`}
          detail="Across listed sessions"
        />
        <MetricCard
          title="Average duration"
          icon={<Clock3 className="size-4" />}
          value={`${averageMinutes} min`}
          detail="Includes active sessions"
        />
      </div>

      <Card className="border-border/70 bg-card/80">
        <CardHeader>
          <CardTitle className="text-lg">Session history</CardTitle>
          <CardDescription>
            Live data recorded for your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading your charging history…
            </p>
          ) : error ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Retry
              </Button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No charging sessions have been recorded yet.
              </p>
              <Button render={<Link href="/hubs" />} variant="outline">
                Explore charging hubs
              </Button>
            </div>
          ) : (
            sessions.map((item) => (
              <Link
                key={item.id}
                href={`/sessions/${item.id}`}
                className="flex flex-col gap-3 border border-border bg-muted/40 p-3 transition-colors hover:bg-muted/70 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                    <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                    Charger {item.stationId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    EVSE {item.evseId} · Connector {item.connectorId}
                  </p>
                  <time className="text-xs text-muted-foreground">
                    {new Date(item.startTime).toLocaleString()}
                  </time>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="size-3.5" />
                    {durationMinutes(item)} min
                  </span>
                  <span className="flex items-center gap-1.5">
                    <BatteryCharging className="size-3.5" />
                    {item.totalKwh.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    kWh
                  </span>
                  {item.totalCost !== null && (
                    <span className="flex items-center gap-1.5">
                      <CreditCard className="size-3.5" />
                      {formatMoney(item.currency, item.totalCost)}
                    </span>
                  )}
                </div>
                <span
                  className={`w-fit border px-2 py-1 text-[10px] font-medium ${
                    item.status === "COMPLETED"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                      : item.status === "FAILED"
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : "border-primary/30 bg-primary/10 text-primary"
                  }`}
                >
                  {item.status.toLowerCase()}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  title,
  icon,
  value,
  detail,
}: {
  title: string;
  icon: ReactNode;
  value: string;
  detail: string;
}) {
  return (
    <Card className="border-border/70 bg-card/80">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <div className="flex size-8 items-center justify-center bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight text-foreground">
          {value}
        </div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
