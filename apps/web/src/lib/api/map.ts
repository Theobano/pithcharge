// apps/web/lib/api/map.ts
import type { MapClusterItem } from "@pithcharge/cms-adapters";
import { toApiError } from "./error";
import { bffUrl } from "./base-url";

export interface FetchMapClustersArgs {
  zoom: number;
  userLat?: number;
  userLng?: number;
  swLat?: number;
  swLng?: number;
  neLat?: number;
  neLng?: number;
  connectorType?: string;
  minPowerKw?: number;
  signal?: AbortSignal;
}

export async function fetchMapClusters(args: FetchMapClustersArgs): Promise<{
  items: MapClusterItem[];
  totalHubs: number;
}> {
  const params = new URLSearchParams();
  params.set("zoom", args.zoom.toString());

  if (args.userLat !== undefined && args.userLng !== undefined) {
    params.set("userLat", args.userLat.toString());
    params.set("userLng", args.userLng.toString());
  }

  if (args.swLat !== undefined && args.swLng !== undefined && args.neLat !== undefined && args.neLng !== undefined) {
    params.set("swLat", args.swLat.toString());
    params.set("swLng", args.swLng.toString());
    params.set("neLat", args.neLat.toString());
    params.set("neLng", args.neLng.toString());
  }

  if (args.connectorType) params.set("connectorType", args.connectorType);
  if (args.minPowerKw) params.set("minPowerKw", args.minPowerKw.toString());

  const response = await fetch(`${bffUrl()}/api/v1/hubs/map?${params.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal: args.signal,
  });

  if (!response.ok) {
    throw await toApiError(response, "Failed to load charging hub map data");
  }

  const json = await response.json();
  return {
    items: json.data,
    totalHubs: json.meta.totalHubs,
  };
}