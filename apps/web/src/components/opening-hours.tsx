"use client";

import { useState } from "react";
import type { ChargingHubDetails } from "@pithcharge/cms-adapters";
import { ChevronDown, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function OpenBadge({ hub }: { hub: Pick<ChargingHubDetails, "openNow" | "openingHours"> }) {
  if (hub.openNow === undefined) return null;
  const alwaysOpen = hub.openingHours?.twentyfourSeven;
  return (
    <Badge variant={hub.openNow ? "default" : "secondary"} className="gap-1">
      <Clock className="h-3 w-3" />
      {alwaysOpen && hub.openNow ? "Open 24/7" : hub.openNow ? "Open now" : "Closed"}
    </Badge>
  );
}

export function OpeningHoursCard({ hub }: { hub: ChargingHubDetails }) {
  const [expanded, setExpanded] = useState(false);
  const hours = hub.openingHours;
  if (!hours) return null;

  const today = (() => {
    try {
      const name = new Intl.DateTimeFormat("en-US", { timeZone: hub.timeZone || "UTC", weekday: "long" }).format(
        new Date(),
      );
      return DAYS.indexOf(name) + 1;
    } catch {
      return 0;
    }
  })();

  const rows = DAYS.map((day, index) => {
    const periods = hours.regularHours
      .filter((period) => period.weekday === index + 1)
      .sort((a, b) => a.periodBegin.localeCompare(b.periodBegin));
    const text = hours.twentyfourSeven
      ? "Open 24 hours"
      : periods.length
        ? periods.map((period) => `${period.periodBegin} – ${period.periodEnd}`).join(", ")
        : "Closed";
    return { day, text, isToday: index + 1 === today };
  });

  const todayRow = rows.find((row) => row.isToday);

  return (
    <div className=" border p-3 text-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <OpenBadge hub={hub} />
          {todayRow && <span className="text-muted-foreground">Today: {todayRow.text}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <dl className="mt-3 space-y-1">
          {rows.map((row) => (
            <div key={row.day} className={`flex justify-between gap-4 ${row.isToday ? "font-medium" : "text-muted-foreground"}`}>
              <dt>{row.day}</dt>
              <dd>{row.text}</dd>
            </div>
          ))}
          {hub.timeZone && <p className="pt-1 text-xs text-muted-foreground">Times shown in {hub.timeZone}</p>}
        </dl>
      )}
    </div>
  );
}
