"use client";

import Link from "next/link";
import { Activity, ArrowRight, MapPin, PlugZap, Wifi } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useActiveSessions, useHubs, useStations } from "@/api/cmsApi";
import { useMyInvitations } from "@/api/invitationApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  const { data: session } = useSession();
  const { data: hubsData, isLoading: hubsLoading } = useHubs({ limit: 5 });
  const { data: stationsData, isLoading: stationsLoading } = useStations({ all: true });
  const { data: activeSessions, isLoading: sessionsLoading } = useActiveSessions();

  const hubs = hubsData?.data ?? [];
  const stations = stationsData?.data ?? [];
  const onlineStations = stations.filter((station) => station.isOnline).length;
  const isAnonymous = Boolean(session?.user?.isAnonymous);
  const { data: pendingInvitations = [] } = useMyInvitations(Boolean(session?.user) && !isAnonymous);

  const stats = [
    {
      label: "Charging hubs",
      value: hubsLoading ? "—" : (hubsData?.total ?? hubs.length),
      helper: "Locations available to browse",
      icon: MapPin,
    },
    {
      label: "Stations",
      value: stationsLoading ? "—" : (stationsData?.total ?? stations.length),
      helper: "Charging stations in the network",
      icon: PlugZap,
    },
    {
      label: "Online now",
      value: stationsLoading ? "—" : onlineStations,
      helper: "Stations reporting online",
      icon: Wifi,
    },
    {
      label: "Active sessions",
      value: sessionsLoading ? "—" : (activeSessions?.length ?? 0),
      helper: "Charging sessions in progress",
      icon: Activity,
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <header className="flex justify-end">
        <Button render={<Link href="/stations" />} className="w-full gap-2 sm:w-auto">
          Find a charger
          <ArrowRight className="size-4" />
        </Button>
      </header>

      {pendingInvitations.map((invitation) => (
        <Card key={invitation.id} className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-2 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">You were invited to join {invitation.organization.name}</p>
              <p className="text-muted-foreground">
                Role: {invitation.role === "user" || !invitation.role ? "member" : invitation.role}
              </p>
            </div>
            <Button render={<Link href={`/invite/${invitation.id}`} />} className="w-fit">
              View invitation
            </Button>
          </CardContent>
        </Card>
      ))}

      {isAnonymous && (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-2 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">You are browsing as a guest</p>
              <p className="text-muted-foreground">
                Sign in to link a charging token and manage your sessions.
              </p>
            </div>
            <Button render={<Link href="/auth/login" />} variant="secondary" className="w-fit">
              Sign in
            </Button>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Network status">
        {stats.map(({ label, value, helper, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Nearby network</CardTitle>
            <Button render={<Link href="/hubs" />} variant="ghost" size="sm" className="gap-1">
              Explore
              <ArrowRight className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {hubs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {hubsLoading ? "Loading available hubs…" : "No charging hubs are available."}
              </p>
            ) : hubs.slice(0, 4).map((hub) => (
              <Link
                key={hub.id}
                href="/hubs"
                className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{hub.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[hub.location.city, hub.location.country].filter(Boolean).join(", ") || "Location details unavailable"}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {hub.stations.length} {hub.stations.length === 1 ? "station" : "stations"}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Live station status</CardTitle>
            <Button render={<Link href="/stations" />} variant="ghost" size="sm" className="gap-1">
              View stations
              <ArrowRight className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {stations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {stationsLoading ? "Loading station status…" : "No station status is available."}
              </p>
            ) : stations.slice(0, 5).map((station) => (
              <Link
                key={station.id}
                href={`/stations/${station.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {station.label || station.ocppConnectionName || station.id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {station.evses.length} EVSE · {station.ocppVersion}
                  </p>
                </div>
                <Badge variant={station.isOnline ? "default" : "secondary"}>
                  {station.isOnline ? "Online" : "Offline"}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
