"use client"

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { BrandMark } from "@/components/brand"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { authClient } from "@/lib/auth-client"


export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const {data:session} = authClient.useSession()
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <BrandMark className="px-2 pt-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0" />
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
      </SidebarContent>
      <SidebarFooter>
        {session && <NavUser user={{name:session.user.name, email:session.user.email, avatar:session.user.image||undefined, isAnonymous:session.user.isAnonymous??undefined}} />}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
