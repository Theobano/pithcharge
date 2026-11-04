"use client";

import { Activity, MapPin, PlugZap, Wifi } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useHubs, useStations, useActiveSessions } from "@/api/cmsApi";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Page() {
  const { data: session } = useSession();
  const { data: hubsData, isLoading: hubsLoading } = useHubs({ limit: 5 });
  const { data: stationsData, isLoading: stationsLoading } = useStations({ limit: 200 });
  const { data: activeSessions = [], isLoading: sessionsLoading } = useActiveSessions();

  const totalHubs = hubsData?.total ?? hubsData?.data?.length ?? 0;
  const totalStations = stationsData?.total ?? stationsData?.data?.length ?? 0;
  const onlineStations = stationsData?.data?.filter((station) => station.isOnline).length ?? 0;
  const activeSessionCount = activeSessions.length;

  const hubPreview = hubsData?.data?.slice(0, 3) ?? [];
  const stationPreview = stationsData?.data?.slice(0, 5) ?? [];

  const userLabel = session?.user?.isAnonymous
    ? "Guest account"
    : session?.user?.name || "Driver";

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <header className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Overview
            </p>
            <h1 className="text-2xl font-semibold text-foreground">
              {session?.user?.isAnonymous ? "Hi there" : `Welcome back, ${session?.user?.name || "driver"}`}
            </h1>
          </div>
          <Badge variant={session?.user?.isAnonymous ? "secondary" : "default"}>
            {userLabel}
          </Badge>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Charging hubs</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{hubsLoading ? "—" : totalHubs}</div>
            <p className="text-xs text-muted-foreground">Available hub locations</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stations</CardTitle>
            <PlugZap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stationsLoading ? "—" : totalStations}</div>
            <p className="text-xs text-muted-foreground">Total charging stations</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Online now</CardTitle>
            <Wifi className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stationsLoading ? "—" : onlineStations}</div>
            <p className="text-xs text-muted-foreground">Stations reporting online</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active sessions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sessionsLoading ? "—" : activeSessionCount}</div>
            <p className="text-xs text-muted-foreground">Currently active charging sessions</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent hubs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hubPreview.length === 0 ? (
              <p className="text-sm text-muted-foreground">No charging hubs are available right now.</p>
            ) : (
              hubPreview.map((hub) => (
                <div
                  key={hub.id}
                  className="flex items-center justify-between rounded-lg border bg-muted/20 p-3"
                >
                  <div>
                    <p className="font-medium">{hub.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {hub.stations.length} stations · {hub.accessType || "Public"}
                    </p>
                  </div>
                  <Badge variant="outline">{hub.stations.length}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live station status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stationPreview.length === 0 ? (
              <p className="text-sm text-muted-foreground">No station data is available right now.</p>
            ) : (
              stationPreview.map((station) => (
                <div
                  key={station.id}
                  className="flex items-center justify-between rounded-lg border bg-muted/20 p-3"
                >
                  <div>
                    <p className="font-medium">{station.label || station.ocppConnectionName || station.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {station.evses.length} EVSE · {station.ocppVersion}
                    </p>
                  </div>
                  <Badge variant={station.isOnline ? "default" : "secondary"}>
                    {station.isOnline ? "Online" : "Offline"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
