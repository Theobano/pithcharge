"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { List, Map as MapIcon, MapPin, Search, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DEFAULT_HUB_FILTERS, HubFilterPopover, HubFilterState, hubMatchesFilters } from "@/components/hub-filters";
import { ChargingHubDetails } from "@pithcharge/cms-adapters";
import { useHubs } from "@/api/cmsApi";
import { fetchMapClusters } from "@/lib/api/map";

const HubsMap = dynamic(() => import("@/components/HubsMap"), {
  ssr: false,
  loading: () => (
    <div className="h-137.5 w-full border animate-pulse flex items-center justify-center text-sm">
      Initializing Map Engine...
    </div>
  ),
});

export default function HubsListPage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<HubFilterState>(DEFAULT_HUB_FILTERS);
  const [view, setView] = useState<"list" | "map">("map");
  const [viewport, setViewport] = useState<{
    swLat: number;
    swLng: number;
    neLat: number;
    neLng: number;
    zoom: number;
  } | null>(null);
  const [queryViewport, setQueryViewport] = useState<typeof viewport>(null);

  const { data: hubsData, isLoading, isError } = useHubs({
    search: search || undefined,
    all: true,
  });
  useEffect(() => {
    const timer = window.setTimeout(() => setQueryViewport(viewport), 250);
    return () => window.clearTimeout(timer);
  }, [viewport]);

  const mapQuery = useQuery({
    queryKey: ["hub-map", queryViewport, search],
    queryFn: ({ signal }) =>
      fetchMapClusters({
        ...queryViewport!,
        connectorType: undefined,
        signal,
      }),
    enabled: view === "map" && queryViewport !== null,
    staleTime: 30_000,
  });
  const handleViewportChange = useCallback(
    (
      bounds: { swLat: number; swLng: number; neLat: number; neLng: number },
      zoom: number,
    ) => setViewport({ ...bounds, zoom }),
    [],
  );

  const hubs = useMemo(() => ((hubsData?.data ?? []) as ChargingHubDetails[]).filter((hub) => hubMatchesFilters(hub, filters)), [hubsData, filters]);

  return (
    <div className="flex flex-col mx-auto h-full w-full space-y-4 p-2 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hubs by name or address"
            className="pl-9"
          />
        </div>
        <HubFilterPopover filters={filters} onChange={setFilters} className="gap-2 font-semibold" />
        <div className="inline-flex border border-border bg-card p-1">
          {([
            ["list", "List", List],
            ["map", "Map", MapIcon],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors",
                view === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1">


      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading charging hubs…</div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-destructive">Failed to fetch charging hubs.</div>
      ) : view === "map" ? (
        <HubsMap
        hubs={hubs as ChargingHubDetails[]}
          onViewportChange={handleViewportChange}
          clusters={mapQuery.data?.items}
        />
      ) : hubs.length === 0 ? (
        <div className="border border-dashed py-16 text-center text-sm text-muted-foreground">
          No hubs match your search or filters.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {hubs.map((hub) => {
            const address = [hub.location?.address, hub.location?.city].filter(Boolean).join(", ");
            return (
              <Link
                key={hub.id}
                href={`/hubs/${hub.id}`}
                className="border border-border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{hub.name}</h3>
                  {hub.accessType && <Badge variant="outline">{hub.accessType}</Badge>}
                </div>
                {address && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {address}
                  </p>
                )}
                <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                  <Zap className="h-3.5 w-3.5" />
                  {hub.stations?.length ?? 0} station{(hub.stations?.length ?? 0) === 1 ? "" : "s"}
                </p>
              </Link>
            );
          })}
        </div>
      )}
            </div>
    </div>
  );
}