"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

/** Shown while a platform admin is signed in as another user. */
export function ImpersonationBanner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [busy, setBusy] = useState(false);

  const impersonatedBy = (session?.session as { impersonatedBy?: string | null } | undefined)
    ?.impersonatedBy;
  if (!impersonatedBy) return null;

  const stop = async () => {
    setBusy(true);
    const result = await authClient.admin.stopImpersonating();
    if (result.error) {
      toast.add({ type: "error", description: result.error.message || "Unable to stop impersonating." });
      setBusy(false);
      return;
    }
    queryClient.clear();
    router.replace("/admin/users");
    setBusy(false);
  };

  return (
    <div
      className="mx-4 mt-4 flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="flex items-center gap-2">
        <UserCog className="size-4 shrink-0" />
        <span>
          You are viewing the app as <strong>{session?.user.name || session?.user.email}</strong>. Actions are
          performed as this user and recorded in the audit log.
        </span>
      </div>
      <Button size="sm" variant="outline" onClick={stop} disabled={busy} className="w-fit">
        {busy ? "Switching…" : "Stop impersonating"}
      </Button>
    </div>
  );
}
