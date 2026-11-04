"use client";

import * as React from "react";
import {
  Building2,
  ChevronsUpDown,
  Plus,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";

export function TeamSwitcher() {
  const { isMobile } = useSidebar();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const { data: organizationData, isPending, refetch } = authClient.useListOrganizations();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const organizations = organizationData ?? [];
  const [error, setError] = React.useState<string | null>(null);

  const setActiveOrganization = async (organizationId: string | null) => {
    setError(null);
    try {
      const result = await authClient.organization.setActive({ organizationId });
      if (result.error) {
        setError(result.error.message || "Unable to switch organization.");
        return;
      }
      await refetch();
      // Sessions, wallets and billing are scoped to the active organization, so drop cached data.
      queryClient.clear();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/dashboard";
    } catch (switchError) {
      setError(
        switchError instanceof Error
          ? switchError.message
          : "Unable to switch organization.",
      );
    }
  };

  const canManageOrganizations = Boolean(
    session?.user && !session.user.isAnonymous,
  );
  const activeName = activeOrganization?.name || "All chargers";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                disabled={!canManageOrganizations || isPending}
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground">
              <Building2 className="size-4" />
            </div>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{activeName}</span>
              <span className="truncate text-xs text-muted-foreground">
                {activeOrganization ? "Organization" : "Public network"}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-64"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Organizations
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => void setActiveOrganization(null)}
                className="gap-2 p-2"
              >
                <Building2 className="size-4" />
                Public network
              </DropdownMenuItem>
              {organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  onClick={() => void setActiveOrganization(organization.id)}
                  className="gap-2 p-2"
                >
                  <Building2 className="size-4" />
                  <span className="truncate">{organization.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {canManageOrganizations && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                    window.location.assign("/settings");
                  }}
                  className="gap-2 p-2"
                >
                  <Plus className="size-4" />
                  Manage organization
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {error && (
          <p className="px-2 pt-1 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
