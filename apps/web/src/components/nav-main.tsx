"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { CaretRightIcon } from "@phosphor-icons/react";
import {
  EvChargerIcon,
  HistoryIcon,
  HomeIcon,
  ScanIcon,
  Settings,
  ShieldCheckIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function NavMain() {
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const isPlatformAdmin =
    (session?.user as { role?: string } | undefined)?.role === "admin";

  const items: {
    title: string;
    url: string;
    icon?: React.ReactNode;
    isActive?: boolean;
    items?: {
      title: string;
      url: string;
    }[];
  }[] = [
    {
      title: "Home",
      url: "/dashboard",
      icon: <HomeIcon />,
      isActive: true,
    },
    {
      title: "Hubs",
      url: "/hubs",
      icon: <EvChargerIcon />,
    },
    {
      title: "Scan",
      url: "/scan",
      icon: <ScanIcon />,
    },
    {
      title: "Sessions",
      url: "/sessions",
      icon: <HistoryIcon />,
    },

    {
      title: "Settings",
      url: "/settings",
      icon: <Settings />,
    },
    ...(isPlatformAdmin
      ? [{ title: "Admin", url: "/admin", icon: <ShieldCheckIcon /> }]
      : []),
  ];
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) =>
          item?.items ? (
            <Collapsible
              key={item.title}
              defaultOpen={"/" + pathname === item.url}
              className="group/collapsible"
              render={<SidebarMenuItem />}
            >
              <CollapsibleTrigger
                render={<SidebarMenuButton tooltip={item.title} />}
              >
                {item.icon}
                <span>{item.title}</span>
                <CaretRightIcon className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items?.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.title}>
                      <SidebarMenuSubButton
                        isActive={pathname === item.url}
                        onClick={() => setOpenMobile(false)}
                        render={<Link href={subItem.url} />}
                      >
                        <span>{subItem.title}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                isActive={pathname === item.url}
                onClick={() => setOpenMobile(false)}
                render={<Link href={item.url} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ),
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
