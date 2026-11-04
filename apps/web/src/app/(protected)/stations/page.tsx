"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChargingHubDetails, StationDetails } from "@pithcharge/cms-adapters";
import { MapPin, Search, SlidersHorizontal, X, Zap } from "lucide-react";
import { useHubs, useStations } from "@/api/cmsApi";
import { NativeSelect } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const HubsMap = dynamic(() => import("@/components/HubsMap"), {
  ssr: false,
  loading: () => (
    <div className="h-137.5 w-full border animate-pulse flex items-center justify-center text-sm">
      Initializing Map Engine...
    </div>
  ),
});

type Availability = "all" | "available" | "charging" | "unavailable";
type SortKey = "name" | "available" | "power";
type View = "list" | "map";

interface Filters {
  availability: Availability;
  connectorType: string;
  minPower: string;
  access: string;
  onlineOnly: boolean;
  sort: SortKey;
}

const DEFAULT_FILTERS: Filters = {
  availability: "all",
  connectorType: "",
  minPower: "",
  access: "",
  onlineOnly: false,
  sort: "name",
};

const CONNECTOR_TYPES = ["CCS2", "Type2", "CHAdeMO", "NACS", "Type1"];

interface StationRow {
  station: StationDetails;
  hub?: ChargingHubDetails;
  availableCount: number;
  chargingCount: number;
  totalConnectors: number;
  maxPowerKw: number;
  types: string[];
  tariff?: { value: number; currency?: string };
}

function toRow(hub: ChargingHubDetails | undefined, station: StationDetails): StationRow {
  const connectors = station.evses.flatMap((evse) => evse.connectors);
  const priced = connectors.find((c) => typeof c.tariffPerKwh === "number" && c.tariffPerKwh > 0);
  return {
    station,
    hub,
    availableCount: connectors.filter((c) => c.status === "Available").length,
    chargingCount: connectors.filter((c) => c.status === "Charging").length,
    totalConnectors: connectors.length,
    maxPowerKw: Math.max(0, ...connectors.map((c) => c.maxPowerKw || 0)),
    types: Array.from(new Set(connectors.map((c) => String(c.type)))),
    tariff: priced ? { value: priced.tariffPerKwh as number, currency: priced.currency } : undefined,
  };
}

function applyFilters(rows: StationRow[], filters: Filters): StationRow[] {
  const minPower = Number(filters.minPower) || 0;
  const filtered = rows.filter((row) => {
    if (filters.onlineOnly && !row.station.isOnline) return false;
    if (filters.access && (row.hub?.accessType ?? "Public") !== filters.access) return false;
    if (filters.connectorType && !row.types.includes(filters.connectorType)) return false;
    if (minPower && row.maxPowerKw < minPower) return false;
    if (filters.availability === "available" && row.availableCount === 0) return false;
    if (filters.availability === "charging" && row.chargingCount === 0) return false;
    if (filters.availability === "unavailable" && (row.availableCount > 0 || row.chargingCount > 0) && row.station.isOnline) return false;
    return true;
  });
  const label = (row: StationRow) => row.station.label || row.station.ocppConnectionName || row.station.id;
  return filtered.sort((a, b) => {
    if (filters.sort === "available") return b.availableCount - a.availableCount || label(a).localeCompare(label(b));
    if (filters.sort === "power") return b.maxPowerKw - a.maxPowerKw || label(a).localeCompare(label(b));
    return label(a).localeCompare(label(b));
  });
}

function StationResultCard({ row }: { row: StationRow }) {
  const { station, hub } = row;
  const label = station.label || station.ocppConnectionName || station.id;
  const place = [hub?.location?.address, hub?.location?.city].filter(Boolean).join(", ");
  const hasFree = row.availableCount > 0;

  return (
    <Link
      href={`/stations/${station.id}`}
      className="group flex flex-col gap-3 border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold group-hover:text-primary">{label}</h3>
          <p className="truncate text-xs text-muted-foreground">{hub?.name ?? ([station.vendor, station.model].filter(Boolean).join(" ") || station.id)}</p>
        </div>
        <Badge variant={station.isOnline ? (hasFree ? "default" : "secondary") : "outline"}>
          {!station.isOnline ? "Offline" : hasFree ? `${row.availableCount} free` : "In use"}
        </Badge>
      </div>

      {place && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{place}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {row.types.map((type) => (
          <span key={type} className="bg-muted px-2 py-0.5 text-xs font-medium">{type}</span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Zap className="h-3.5 w-3.5" />
          {row.maxPowerKw > 0 ? `Up to ${row.maxPowerKw} kW` : "Power n/a"}
        </span>
        <span>
          {row.availableCount}/{row.totalConnectors} connectors free
          {row.tariff ? ` · ${row.tariff.currency ?? ""} ${row.tariff.value}/kWh` : ""}
        </span>
      </div>
    </Link>
  );
}

export default function StationsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [view, setView] = useState<View>("list");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const stationsQuery = useStations({ all: true });
  const hubsQuery = useHubs({ all: true });
  const { isLoading, isError, refetch } = stationsQuery;
  const hubs = useMemo(() => (hubsQuery.data?.data ?? []) as ChargingHubDetails[], [hubsQuery.data]);
  const stations = useMemo(() => (stationsQuery.data?.data ?? []) as StationDetails[], [stationsQuery.data]);

  // Stations are the source of truth; the hub is attached only when the CSMS links one.
  const rows = useMemo(() => {
    const hubById = new Map(hubs.map((hub) => [hub.id, hub]));
    return stations.map((station) => toRow(hubById.get(station.hubId), station));
  }, [stations, hubs]);
  const results = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const visible = useMemo(() => {
    if (!search) return results;
    const q = search.toLowerCase();
    return results.filter((row) =>
      [row.station.label, row.station.ocppConnectionName, row.station.id, row.station.vendor, row.station.model, row.hub?.name, row.hub?.location?.address, row.hub?.location?.city]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [results, search]);

  const mapHubs = useMemo(() => {
    const ids = new Set(visible.map((row) => row.station.hubId).filter(Boolean));
    return hubs.filter((hub) => ids.has(hub.id));
  }, [visible, hubs]);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const activeFilterCount =
    (filters.availability !== "all" ? 1 : 0) +
    (filters.connectorType ? 1 : 0) +
    (filters.minPower ? 1 : 0) +
    (filters.access ? 1 : 0) +
    (filters.onlineOnly ? 1 : 0);
  const reset = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchInput("");
  };

  return (
    <div className="mx-auto w-full flex-1 space-y-4 p-2 sm:p-6">
      <div className="flex justify-end">
        <div className="inline-flex border p-0.5">
          {(["list", "map"] as View[]).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={view === option ? "default" : "ghost"}
              onClick={() => setView(option)}
              className="capitalize"
            >
              {option}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3 border bg-card p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by station, location, address or city"
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={() => setShowFilters((v) => !v)} className="shrink-0">
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "All"],
              ["available", "Available now"],
              ["charging", "In use"],
              ["unavailable", "Unavailable"],
            ] as Array<[Availability, string]>
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filters.availability === value ? "default" : "outline"}
              className="rounded-full"
              onClick={() => set("availability", value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {showFilters && (
          <div className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="space-y-1 text-xs text-muted-foreground">
              Connector type
              <NativeSelect value={filters.connectorType} onChange={(e) => set("connectorType", e.target.value)}>
                <option value="">Any</option>
                {CONNECTOR_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </NativeSelect>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Minimum power
              <NativeSelect value={filters.minPower} onChange={(e) => set("minPower", e.target.value)}>
                <option value="">Any</option>
                <option value="7">7 kW+</option>
                <option value="22">22 kW+</option>
                <option value="50">50 kW+</option>
                <option value="100">100 kW+</option>
              </NativeSelect>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Access
              <NativeSelect value={filters.access} onChange={(e) => set("access", e.target.value)}>
                <option value="">Any</option>
                <option value="Public">Public</option>
                <option value="Private">Private</option>
                <option value="Restricted">Restricted</option>
              </NativeSelect>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Sort by
              <NativeSelect value={filters.sort} onChange={(e) => set("sort", e.target.value as SortKey)}>
                <option value="name">Name</option>
                <option value="available">Most available</option>
                <option value="power">Highest power</option>
              </NativeSelect>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={filters.onlineOnly}
                onChange={(e) => set("onlineOnly", e.target.checked)}
                className="h-4 w-4"
              />
              Online stations only
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{isLoading ? "Loading…" : `${visible.length} of ${rows.length} stations`}</span>
        {(activeFilterCount > 0 || searchInput) && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear all
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : isError ? (
        <div className="border border-destructive/30 p-10 text-center">
          <p className="text-sm text-destructive">Failed to load stations.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : view === "map" ? (
        <HubsMap hubs={mapHubs} />
      ) : visible.length === 0 ? (
        <div className="border p-10 text-center text-sm text-muted-foreground">
          No stations match your search. Try adjusting the filters.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((row) => <StationResultCard key={row.station.id} row={row} />)}
        </div>
      )}
    </div>
  );
}
