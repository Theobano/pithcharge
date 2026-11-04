"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function AuthSessionRedirect({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next");
  const invitation = searchParams.get("invitation");
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (invitation) {
      router.replace(`/invite/${encodeURIComponent(invitation)}`);
    } else if (session) {
      router.replace(nextUrl || "/hubs");
    }
  }, [session, nextUrl, invitation, router]);

  return <>{children}</>;
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={children}>
      <AuthSessionRedirect>{children}</AuthSessionRedirect>
    </Suspense>
  );
}
