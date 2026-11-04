"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { StationDetails } from "@pithcharge/cms-adapters";
import { Clock, Layers, MapPin, Navigation, PlugZap, Search, Wifi, WifiOff, Zap } from "lucide-react";
import { useHubDetails } from "@/api/cmsApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Filter = "all" | "available" | "charging" | "offline";

function summarize(station: StationDetails) {
  const connectors = station.evses.flatMap((evse) => evse.connectors);
  const available = connectors.filter((c) => c.status === "Available").length;
  const charging = connectors.filter((c) => c.status === "Charging" || c.status === "Occupied").length;
  const priced = connectors.find((c) => c.tariffPerKwh != null);
  return {
    connectors,
    available,
    charging,
    maxPowerKw: connectors.reduce((max, c) => Math.max(max, c.maxPowerKw || 0), 0),
    types: [...new Set(connectors.map((c) => c.type))],
    tariff: priced ? { value: priced.tariffPerKwh as number, currency: priced.currency } : undefined,
  };
}

function relativeTime(iso?: string) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return "unknown";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export default function HubDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: hub, isLoading, error } = useHubDetails(id);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(
    () => (hub?.stations ?? []).map((station) => ({ station, ...summarize(station) })),
    [hub],
  );

  const totals = useMemo(
    () => ({
      stations: rows.length,
      online: rows.filter((r) => r.station.isOnline).length,
      connectors: rows.reduce((sum, r) => sum + r.connectors.length, 0),
      available: rows.reduce((sum, r) => sum + (r.station.isOnline ? r.available : 0), 0),
      maxPowerKw: rows.reduce((max, r) => Math.max(max, r.maxPowerKw), 0),
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      const { station } = row;
      if (needle && ![station.label, station.id, station.ocppConnectionName, station.vendor, station.model]
        .some((value) => value?.toLowerCase().includes(needle))) return false;
      if (filter === "available") return station.isOnline && row.available > 0;
      if (filter === "charging") return row.charging > 0;
      if (filter === "offline") return !station.isOnline;
      return true;
    });
  }, [rows, search, filter]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error || !hub) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Hub not found."}</p>
            <Button render={<Link href="/hubs" />} variant="outline">Back to hubs</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { location } = hub;
  const address = [location.address, location.city, location.state, location.postalCode, location.country]
    .filter(Boolean)
    .join(", ");
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-6">
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 className="truncate text-xl font-semibold">{hub.name}</h2>
              {address && (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  {address}
                </p>
              )}
              {hub.description && <p className="text-sm text-muted-foreground">{hub.description}</p>}
            </div>
            <div className="flex items-center gap-2">
              {hub.accessType && <Badge variant="outline">{hub.accessType}</Badge>}
              <Button render={<a href={directions} target="_blank" rel="noopener noreferrer" />} size="sm" variant="outline">
                <Navigation className="mr-2 h-4 w-4" />
                Directions
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Stations", value: `${totals.online}/${totals.stations} online`, icon: Layers },
              { label: "Connectors", value: String(totals.connectors), icon: PlugZap },
              { label: "Available now", value: String(totals.available), icon: Wifi },
              { label: "Max power", value: totals.maxPowerKw ? `${totals.maxPowerKw} kW` : "—", icon: Zap },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="border border-border bg-muted/30 p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </p>
                <p className="mt-1 text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search stations in this hub"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All"],
                ["available", "Available"],
                ["charging", "In use"],
                ["offline", "Offline"],
              ] as Array<[Filter, string]>
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">{visible.length} of {rows.length} stations</p>

        {visible.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? "This hub has no stations yet." : "No stations match your filters."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map(({ station, connectors, available, charging, maxPowerKw, types, tariff }) => (
              <Link key={station.id} href={`/stations/${encodeURIComponent(station.id)}`} className="block">
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{station.label || station.ocppConnectionName || station.id}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[station.vendor, station.model].filter(Boolean).join(" · ") || `OCPP ${station.ocppVersion}`}
                        </p>
                      </div>
                      <Badge variant={station.isOnline ? "default" : "secondary"} className="shrink-0 gap-1">
                        {station.isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                        {station.isOnline ? "Online" : "Offline"}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {types.map((type) => <Badge key={type} variant="outline">{type}</Badge>)}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Available</p>
                        <p className="font-semibold">{station.isOnline ? `${available}/${connectors.length}` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">In use</p>
                        <p className="font-semibold">{charging}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Power</p>
                        <p className="font-semibold">{maxPowerKw ? `${maxPowerKw} kW` : "—"}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                      <span>{tariff ? `${tariff.value} ${tariff.currency ?? ""}/kWh` : "Rate set at start"}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {relativeTime(station.lastHeartbeat)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
