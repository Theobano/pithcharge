"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  CircleMarker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import {
  ChargingHubDetails,
  MapPointCluster,
  MapPointHub,
  MapClusterItem,
  ConnectorStatus,
} from "@pithcharge/cms-adapters";

import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "./ui/drawer";
import { Separator } from "./ui/separator";

import {
  LocateFixed,
  X,
  Zap,
  MapPin,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Plug,
  Navigation,
} from "lucide-react";
import {
  DEFAULT_HUB_FILTERS,
  HubFilterPopover,
  HubFilterState,
  matchesHubFilters,
} from "./hub-filters";
import { useIsMobile } from "@/hooks/use-mobile";

function createClusterIcon(count: number): L.DivIcon {
  return L.divIcon({
    html: `<div class="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-600 text-white font-bold shadow-lg ring-4 ring-emerald-200 border-2 border-white text-xs">${count}</div>`,
    className: "custom-cluster-marker",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function createHubIcon(
  availableChargers: number,
  isSelected: boolean,
  isOnline: boolean,
): L.DivIcon {
  const bgClass = !isOnline
    ? "bg-slate-500"
    : availableChargers > 0
      ? "bg-emerald-600"
      : "bg-amber-500";

  return L.divIcon({
    html: `<div class="flex items-center justify-center min-w-9 h-8 px-2.5 rounded-full font-bold shadow-md text-xs text-white transition-transform ${bgClass} ${
      isSelected
        ? "ring-4 ring-primary border-2 scale-110"
        : "border-2 hover:scale-105"
    }">${availableChargers}</div>`,
    className: "custom-station-marker",
    iconSize: [36, 32],
    iconAnchor: [18, 16],
  });
}

function MapRecenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, 14, { duration: 1.2 });
  }, [center, map]);
  return null;
}

function ClusterMarker({ cluster }: { cluster: MapPointCluster }) {
  const map = useMap();

  return (
    <Marker
      position={[cluster.latitude, cluster.longitude]}
      icon={createClusterIcon(cluster.pointCount)}
      eventHandlers={{
        click: () =>
          map.fitBounds(
            [
              [cluster.bounds.swLat, cluster.bounds.swLng],
              [cluster.bounds.neLat, cluster.bounds.neLng],
            ],
            { padding: [40, 40], maxZoom: 16 },
          ),
      }}
    />
  );
}

function MapEventsHandler({
  onViewportChange,
}: {
  onViewportChange: (
    bounds: { swLat: number; swLng: number; neLat: number; neLng: number },
    zoom: number,
  ) => void;
}) {
  const map = useMap();
  const triggerChange = useCallback(() => {
    const b = map.getBounds();
    onViewportChange(
      {
        swLat: b.getSouthWest().lat,
        swLng: b.getSouthWest().lng,
        neLat: b.getNorthEast().lat,
        neLng: b.getNorthEast().lng,
      },
      map.getZoom(),
    );
  }, [map, onViewportChange]);

  useMapEvents({
    moveend: triggerChange,
    zoomend: triggerChange,
  });

  useEffect(() => {
    triggerChange();
  }, [triggerChange]);

  return null;
}

interface HubsMapProps {
  hubs: ChargingHubDetails[];
  onViewportChange?: (
    bounds: { swLat: number; swLng: number; neLat: number; neLng: number },
    zoom: number,
  ) => void;
  clusters?: MapClusterItem[];
  /** When provided, the map is filtered by the parent and its own filter button is hidden. */
  filters?: HubFilterState;
}

export default function HubsMap({
  hubs,
  onViewportChange,
  clusters,
  filters: externalFilters,
}: HubsMapProps) {
  const [userLocation, setUserLocation] = useState<[number, number] | null>(
    null,
  );
  const [isLocating, setIsLocating] = useState(false);
  const [recenterPos, setRecenterPos] = useState<[number, number] | null>(null);
  const [selectedHub, setSelectedHub] = useState<MapPointHub | null>(null);

  const [internalFilters, setFilters] =
    useState<HubFilterState>(DEFAULT_HUB_FILTERS);
  const filters = externalFilters ?? internalFilters;

  const defaultLat = hubs[0]?.location?.latitude ?? 6.5244;
  const defaultLng = hubs[0]?.location?.longitude ?? 3.3792;

  const handleLocateUser = useCallback(() => {
    if (!navigator.geolocation) return;

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords: [number, number] = [
          position.coords.latitude,
          position.coords.longitude,
        ];
        setUserLocation(coords);
        setRecenterPos(coords);
        setIsLocating(false);
      },
      (error) => {
        console.warn("Geolocation request failed or denied:", error.message);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleLocateUser();
  }, [handleLocateUser]);

  const mappedHubs = useMemo<MapPointHub[]>(() => {
    return hubs
      .map((hub) => {
        let totalChargers = 0;
        let availableChargers = 0;
        let onlineStations = 0;
        const connectorSummaryMap = new Map<
          string,
          { type: string; count: number; maxPowerKw: number }
        >();

        hub.stations.forEach((station) => {
          if (station.isOnline) onlineStations += 1;

          station.evses.forEach((evse) => {
            const connectors =
              evse.connectors && evse.connectors.length > 0
                ? evse.connectors
                : [
                    {
                      connectorId: 1,
                      type: "CCS2",
                      status: (evse.status as ConnectorStatus) || "Available",
                      maxPowerKw: 150,
                      tariffPerKwh: 250,
                      currency: "NGN",
                    },
                  ];

            connectors.forEach((connector) => {
              totalChargers += 1;
              if (
                connector.status === "Available" ||
                evse.status === "Available"
              ) {
                availableChargers += 1;
              }

              const typeKey = connector.type || "Unknown";
              const existing = connectorSummaryMap.get(typeKey);
              if (existing) {
                existing.count += 1;
                existing.maxPowerKw = Math.max(
                  existing.maxPowerKw,
                  connector.maxPowerKw || 0,
                );
              } else {
                connectorSummaryMap.set(typeKey, {
                  type: typeKey,
                  count: 1,
                  maxPowerKw: connector.maxPowerKw || 150,
                });
              }
            });
          });
        });

        let distanceKm: number | undefined;
        if (userLocation && hub.location?.latitude && hub.location?.longitude) {
          const R = 6371;
          const dLat =
            ((hub.location.latitude - userLocation[0]) * Math.PI) / 180;
          const dLon =
            ((hub.location.longitude - userLocation[1]) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((userLocation[0] * Math.PI) / 180) *
              Math.cos((hub.location.latitude * Math.PI) / 180) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2);
          distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }

        return {
          type: "hub" as const,
          id: hub.id,
          name: hub.name,
          location: hub.location,
          totalStations: hub.stations.length,
          onlineStations,
          totalChargers,
          availableChargers,
          connectorSummary: Array.from(connectorSummaryMap.values()),
          distanceKm,
          stations: hub.stations,
        };
      })
      .filter((hub) => {
        if (hub.totalChargers < 1) return false;
        if (
          !matchesHubFilters(filters, hub.onlineStations, hub.connectorSummary)
        )
          return false;

        return true;
      })
      .sort((a, b) => {
        if (userLocation) {
          return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
        }
        return 0;
      });
  }, [hubs, userLocation, filters]);

  const displayItems: MapClusterItem[] = clusters ?? mappedHubs;

  const isMobile = useIsMobile();

  const selectedLat = selectedHub?.location?.latitude ?? defaultLat;
  const selectedLng = selectedHub?.location?.longitude ?? defaultLng;
  const googleMapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${selectedLat},${selectedLng}`;

  return (
    <div className="h-full w-full overflow-hidden border shadow-lg relative z-0 flex flex-col md:flex-row bg-background">
      <div className="absolute top-3 left-12 right-3 z-1000 flex items-center justify-between pointer-events-none">
        {externalFilters ? (
          <span />
        ) : (
          <HubFilterPopover
            filters={filters}
            onChange={setFilters}
            className="pointer-events-auto gap-2 border bg-background/30 font-semibold shadow-md backdrop-blur"
          />
        )}

        <Button
          size="sm"
          onClick={handleLocateUser}
          disabled={isLocating}
          className="pointer-events-auto bg-background/30 disabled:opacity-90 backdrop-blur shadow-md font-semibold gap-2 border"
        >
          <LocateFixed
            className={`w-4 h-4 ${isLocating ? "animate-spin text-amber-500" : "text-blue-600"}`}
          />
          <span>{isLocating ? "Locating..." : "My Location"}</span>
        </Button>
      </div>

      <div className="h-full w-full relative flex-1">
        <MapContainer
          center={[defaultLat, defaultLng]}
          zoom={12}
          scrollWheelZoom={true}
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {recenterPos && <MapRecenter center={recenterPos} />}
          {onViewportChange && (
            <MapEventsHandler onViewportChange={onViewportChange} />
          )}

          {userLocation && (
            <CircleMarker
              center={userLocation}
              radius={8}
              pathOptions={{
                fillColor: "#2563EB",
                fillOpacity: 0.9,
                color: "#FFFFFF",
                weight: 2,
              }}
            />
          )}

          {displayItems.map((item) => {
            if (item.type === "cluster") {
              return <ClusterMarker key={item.id} cluster={item} />;
            }

            const lat = item.location?.latitude ?? defaultLat;
            const lng = item.location?.longitude ?? defaultLng;
            const isSelected = selectedHub?.id === item.id;

            return (
              <Marker
                key={item.id}
                position={[lat, lng]}
                icon={createHubIcon(
                  item.availableChargers,
                  isSelected,
                  item.onlineStations > 0,
                )}
                eventHandlers={{
                  click: () => setSelectedHub(item),
                }}
              />
            );
          })}
        </MapContainer>
      </div>

      {selectedHub && (
        <Drawer
          open={Boolean(selectedHub)}
          swipeDirection={isMobile ? "down" : "right"}
          showSwipeHandle={isMobile}
          modal={false}
          onOpenChange={(open) => {
            if (!open) setSelectedHub(null);
          }}
        >
          <DrawerContent className="h-[75vh] w-full sm:max-w-md sm:h-full sm:w-md">
            <DrawerHeader className="p-4 pb-3 border-b">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2 min-w-0 flex-1">
                  <DrawerTitle className="text-base font-bold leading-snug text-left">
                    {selectedHub.name}
                  </DrawerTitle>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground text-left">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {selectedHub.location?.address ||
                        "Location address unavailable"}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setSelectedHub(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <Button
                render={
                  <a
                    href={googleMapsDirectionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                nativeButton={false}
                variant="outline"
                className="w-full mt-2 gap-2 font-semibold shadow-xs border-primary/20 hover:bg-primary/5"
              >
                <Navigation className="w-4 h-4 text-blue-600 fill-blue-600/20" />
                <span>Get Directions</span>
              </Button>
            </DrawerHeader>

            <div className="p-4 flex-1 flex flex-col space-y-4 min-h-0 overflow-auto">
              <div className="flex items-center justify-between text-xs shrink-0">
                <Badge
                  variant={
                    selectedHub.onlineStations > 0 ? "default" : "secondary"
                  }
                  className="gap-1"
                >
                  {selectedHub.onlineStations > 0 ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-slate-400" />
                  )}
                  {selectedHub.onlineStations}/{selectedHub.totalStations}{" "}
                  Stations Online
                </Badge>

                {selectedHub.distanceKm !== undefined && (
                  <span className="font-semibold text-primary">
                    {selectedHub.distanceKm.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}{" "}
                    km away
                  </span>
                )}
              </div>

              <Separator />

              <div className="space-y-2 flex-1 flex flex-col min-h-0">
                <div className="flex justify-between items-center shrink-0">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Stations ({selectedHub.totalStations})
                  </h4>
                  <span className="text-xs text-emerald-600 font-semibold">
                    {selectedHub.availableChargers} Chargers Available
                  </span>
                </div>

                <div className="space-y-4  pr-1">
                  {selectedHub.stations.map((station) => (
                    <div
                      key={station.id}
                      className="p-3 border bg-muted/40 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-500" />
                          {station.label || station.id}
                        </span>
                        <Badge
                          variant={station.isOnline ? "default" : "secondary"}
                        >
                          {station.isOnline ? "Online" : "Offline"}
                        </Badge>
                      </div>

                      {station.evses.map((evse) => {
                        const connectors =
                          evse.connectors && evse.connectors.length > 0
                            ? evse.connectors
                            : [
                                {
                                  connectorId: 1,
                                  type: "CCS2",
                                  status:
                                    (evse.status as ConnectorStatus) ||
                                    "Available",
                                  maxPowerKw: 150,
                                  tariffPerKwh: 250,
                                  currency: "NGN",
                                },
                              ];

                        return (
                          <div
                            key={`${station.id}-${evse.evseId}`}
                            className="space-y-2"
                          >
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              EVSE #{evse.evseId}
                            </div>
                            {connectors.map((connector, idx) => (
                              <div
                                key={`${station.id}-${evse.evseId}-${idx}`}
                                className="flex items-center justify-between p-2 border bg-background text-xs"
                              >
                                <div>
                                  <div className="font-bold flex items-center gap-1">
                                    <Plug className="w-3 h-3 text-muted-foreground" />
                                    {connector.type}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {connector.maxPowerKw || 150} kW Output
                                  </div>
                                </div>

                                <div className="text-right">
                                  <div className="font-bold text-emerald-600 text-xs">
                                    {connector.currency || "NGN"}{" "}
                                    {connector.tariffPerKwh
                                      ? `${connector.tariffPerKwh} / kWh`
                                      : "Not set"}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    Plug #{connector.connectorId}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}

                      <Button
                        render={<Link href={`/stations/${station.id}`} />}
                        nativeButton={false}
                        size="sm"
                        className="w-full gap-2 font-semibold shadow-xs text-xs"
                      >
                        <span className="text-primary-foreground">
                          View station
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-primary-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
