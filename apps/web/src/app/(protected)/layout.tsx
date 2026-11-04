"use client";

import { toApiError } from "@/lib/api/error";
import { apiUrl } from "@/lib/api/base-url";
import { AppSidebar } from "@/components/app-sidebar";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";

// Ordered most specific first; the first matching pattern supplies the header title.
const PAGE_TITLES: Array<[RegExp, string]> = [
  [/^\/dashboard/, "Dashboard"],
  [/^\/stations\/[^/]+\/connectors\//, "Connector"],
  [/^\/stations\/[^/]+/, "Station details"],
  [/^\/stations/, "Find a charger"],
  [/^\/hubs\/[^/]+/, "Hub details"],
  [/^\/hubs/, "Charging hubs"],
  [/^\/sessions\/[^/]+/, "Session details"],
  [/^\/sessions/, "Charging sessions"],
  [/^\/transactions/, "Transactions"],
  [/^\/scan/, "Scan to charge"],
  [/^\/settings/, "Settings"],
  [/^\/admin\/organizations\/[^/]+/, "Organization"],
  [/^\/admin\/organizations/, "Organizations"],
  [/^\/admin\/users\/[^/]+/, "User"],
  [/^\/admin\/users/, "Users"],
  [/^\/admin\/reports/, "Reports"],
  [/^\/admin\/charging-rates/, "Public rates"],
  [/^\/admin\/audit/, "Audit log"],
  [/^\/admin/, "Platform overview"],
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const title = PAGE_TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? "";
  const isRootPage = pathname === "/dashboard";
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/dashboard");
  };
  const { data: session, isPending } = authClient.useSession();
  const tokenSetupUser = useRef<string | null>(null);
  const [tokenSetupError, setTokenSetupError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) {
      const nextUrl =
        pathname !== "/auth/login"
          ? `?next=${encodeURIComponent(pathname)}`
          : "";
      router.replace(`/auth/login${nextUrl}`);
    }
  }, [session, isPending, pathname, router]);

  useEffect(() => {
    const user = session?.user;
    if (!user || user.isAnonymous || tokenSetupUser.current === user.id) return;

    tokenSetupUser.current = user.id;
    const apiBase = apiUrl();
    void fetch(`${apiBase}/users/idtoken`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw await toApiError(
            response,
            `Token setup failed (${response.status}).`,
          );
        }
      })
      .catch((error: unknown) => {
        setTokenSetupError(
          error instanceof Error
            ? error.message
            : "Could not activate your charging token.",
        );
      });
  }, [session?.user]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-x-hidden">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          {!isRootPage && (
            <Button variant="ghost" size="icon" aria-label="Go back" onClick={goBack}>
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
        </header>
        <ImpersonationBanner />
        {tokenSetupError && (
          <div
            className="mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            Your account is ready, but your charging token could not be
            activated. {tokenSetupError}
          </div>
        )}
        <>{children}</>
      </SidebarInset>
    </SidebarProvider>
  );
}
