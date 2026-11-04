"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, Loader2, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";
import { acceptInvitation, useInvitationPreview } from "@/api/invitationApi";

const roleLabel = (role: string) => (role === "user" ? "member" : role);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

export default function InvitePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: invitation, isLoading, error } = useInvitationPreview(id);
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const user = session?.user;
  const registered = Boolean(user && !user.isAnonymous);
  const emailMatches =
    registered && invitation && user?.email.toLowerCase() === invitation.email.toLowerCase();

  const join = async () => {
    try {
      const result = await acceptInvitation(id);
      const switched = await authClient.organization.setActive({ organizationId: result.organizationId });
      if (switched.error) throw new Error(switched.error.message);
      queryClient.clear();
      toast.add({ type: "success", description: `You joined ${invitation?.organization.name}.` });
      router.replace("/dashboard");
    } catch (joinError) {
      toast.add({
        type: "error",
        description: joinError instanceof Error ? joinError.message : "Unable to accept the invitation.",
      });
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!invitation) return;
    if (!invitation.accountExists && password !== confirmPassword) {
      toast.add({ type: "error", description: "Passwords do not match" });
      return;
    }
    setBusy(true);
    const handlers = {
      onSuccess: () => void join(),
      onError: (ctx: { error: { message: string } }) => {
        toast.add({ type: "error", description: ctx.error.message });
        setBusy(false);
      },
    };
    if (invitation.accountExists) {
      await authClient.signIn.email({ email: invitation.email, password }, handlers);
    } else {
      await authClient.signUp.email(
        { name: name.trim() || invitation.email, email: invitation.email, password },
        handlers,
      );
    }
  };

  if (isLoading || sessionPending) {
    return (
      <Shell>
        <div className="flex justify-center py-20 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (error || !invitation) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>Invitation not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : "This invitation link is not valid."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/auth/login" />} className="w-full">Go to sign in</Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (invitation.status !== "pending") {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <MailWarning className="size-8 text-muted-foreground" />
            <CardTitle>Invitation {invitation.status}</CardTitle>
            <CardDescription>
              This invitation to {invitation.organization.name} can no longer be used. Ask an
              organization admin to send a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/dashboard" />} className="w-full">Continue</Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const header = (
    <CardHeader className="items-center text-center">
      <div className="mb-2 flex size-12 items-center justify-center bg-primary/10 text-primary">
        <Building2 className="size-6" />
      </div>
      <CardTitle>Join {invitation.organization.name}</CardTitle>
      <CardDescription>
        {invitation.invitedBy ? `${invitation.invitedBy} invited you` : "You were invited"} to join as{" "}
        <strong>{roleLabel(invitation.role)}</strong>.
      </CardDescription>
    </CardHeader>
  );

  if (registered && !emailMatches) {
    return (
      <Shell>
        <Card>
          {header}
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This invitation is for <strong>{invitation.email}</strong>, but you are signed in as{" "}
              <strong>{user?.email}</strong>.
            </p>
            <Button
              className="w-full"
              onClick={async () => {
                await authClient.signOut();
                queryClient.clear();
              }}
            >
              Sign out and continue
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (emailMatches) {
    return (
      <Shell>
        <Card>
          {header}
          <CardContent>
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void join();
              }}
            >
              <CheckCircle2 className="size-4" />
              {busy ? "Joining…" : "Accept invitation"}
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        {header}
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input id="invite-email" type="email" value={invitation.email} readOnly />
              </Field>
              {!invitation.accountExists && (
                <Field>
                  <FieldLabel htmlFor="invite-name">Full name</FieldLabel>
                  <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="invite-password">
                  {invitation.accountExists ? "Password" : "Create a password"}
                </FieldLabel>
                <Input
                  id="invite-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              {!invitation.accountExists && (
                <Field>
                  <FieldLabel htmlFor="invite-password2">Confirm password</FieldLabel>
                  <Input
                    id="invite-password2"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </Field>
              )}
              <Button type="submit" disabled={busy} className="w-full">
                {busy
                  ? "Please wait…"
                  : invitation.accountExists
                    ? "Sign in and join"
                    : "Create account and join"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}
