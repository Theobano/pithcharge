"use client";

import { Filter, RotateCcw } from "lucide-react";
import type { ChargingHubDetails } from "@pithcharge/cms-adapters";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export interface HubFilterState {
  connectorType: string;
  minPowerKw: number;
  onlyActive: boolean;
}

export const DEFAULT_HUB_FILTERS: HubFilterState = {
  connectorType: "ALL",
  minPowerKw: 0,
  onlyActive: false,
};

export const CONNECTOR_TYPES = [
  { label: "All Plug Types", value: "ALL" },
  { label: "Type 2 (AC)", value: "Type2" },
  { label: "CCS2 (Fast DC)", value: "CCS2" },
  { label: "CHAdeMO", value: "CHAdeMO" },
];

export const isHubFilterActive = (f: HubFilterState) =>
  f.connectorType !== "ALL" || f.minPowerKw > 0 || f.onlyActive;

interface ConnectorSummary {
  type: string;
  maxPowerKw: number;
}

export function matchesHubFilters(
  filters: HubFilterState,
  onlineStations: number,
  connectors: ConnectorSummary[],
): boolean {
  if (filters.onlyActive && onlineStations < 1) return false;
  if (
    filters.connectorType !== "ALL" &&
    !connectors.some((c) => c.type.toLowerCase() === filters.connectorType.toLowerCase())
  ) {
    return false;
  }
  if (filters.minPowerKw > 0 && !connectors.some((c) => c.maxPowerKw >= filters.minPowerKw)) {
    return false;
  }
  return true;
}

export function hubMatchesFilters(hub: ChargingHubDetails, filters: HubFilterState): boolean {
  if (!isHubFilterActive(filters)) return true;
  const stations = hub.stations ?? [];
  const connectors = stations.flatMap((s) =>
    s.evses.flatMap((e) =>
      (e.connectors ?? []).map((c) => ({ type: String(c.type), maxPowerKw: c.maxPowerKw || 0 })),
    ),
  );
  return matchesHubFilters(filters, stations.filter((s) => s.isOnline).length, connectors);
}

export function HubFilterPopover({
  filters,
  onChange,
  className,
}: {
  filters: HubFilterState;
  onChange: (next: HubFilterState) => void;
  className?: string;
}) {
  const active = isHubFilterActive(filters);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" className={className ?? "gap-2 font-semibold"}>
            <Filter className="h-4 w-4" />
            <span>Filters</span>
            {active && <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />}
          </Button>
        }
      />
      <PopoverContent className="z-1001 w-80 space-y-4 p-4 shadow-xl" align="end">
        <div className="flex items-center justify-between border-b pb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Filter Hubs
          </h4>
          {active && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onChange(DEFAULT_HUB_FILTERS)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Connector Type</Label>
          <Select
            value={filters.connectorType}
            onValueChange={(val) => onChange({ ...filters, connectorType: val || "ALL" })}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select Connector" />
            </SelectTrigger>
            <SelectContent>
              {CONNECTOR_TYPES.map((item) => (
                <SelectItem key={item.value} value={item.value} className="text-xs">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold">Min Power Output</Label>
            <span className="text-xs font-bold text-emerald-600">{filters.minPowerKw} kW</span>
          </div>
          <Slider
            value={[filters.minPowerKw]}
            max={250}
            step={10}
            onValueChange={(val) =>
              onChange({ ...filters, minPowerKw: typeof val === "number" ? val : (val[0] ?? 0) })
            }
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <Label htmlFor="online-only" className="cursor-pointer text-xs font-medium">
            Active Hubs Only
          </Label>
          <Switch
            id="online-only"
            checked={filters.onlyActive}
            onCheckedChange={(checked) => onChange({ ...filters, onlyActive: checked })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
