import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { toast } from "@/components/ui/toast";
import Link from "next/link";

export function LoginForm({
  fullForm = true,
  className,
  ...props
}:
  {fullForm?: boolean} & React.ComponentProps<"form">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || submitting) return;
    setSubmitting(true);
    await authClient.signIn.email(
      { email, password, rememberMe },
      {
        onError: (ctx) => {
          toast.add({
            type: "error",
            description: ctx.error.message || "Unable to sign in. Check your email and password.",
          });
        },
      },
    );
    setSubmitting(false);
  };

  const handleGoogleSignIn = async () => {
    await authClient.signIn.social(
      { provider: "google", callbackURL: `${window.location.origin}/dashboard` },
      {
        onError: (ctx) => {
          toast.add({
            type: "error",
            description: ctx.error.message || "Google sign-in is not available right now.",
          });
        },
      },
    );
  };

  const handleGuestContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    await authClient.signIn.anonymous({}, {
      onError: (ctx) => {
        if (ctx.error.code === "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY") {
          toast.add({
            type: "error",
            description: "You are already signed in as a guest. Please sign out first to continue as a different guest.",
          });
          return;
        } 
        toast.add({
          type: "error",
          description: ctx.error.message,
        });
      },
    
    });
  };

  return (
    <form className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Login to your account</h1>
          <p className="text-sm text-balance text-muted-foreground">
            Enter your email below to login to your account
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" placeholder="m@example.com"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            required />
        </Field>
        <Field>
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            {fullForm && (
              <Link
                href="/auth/forgot-password"
                className="ml-auto text-sm underline-offset-4 hover:underline"
              >
                Forgot your password?
              </Link>
            )}
          </div>
          <Input id="password" type="password"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
            required />
        </Field>
        <Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            Remember me
          </label>
        </Field>
        <Field>
          <Button onClick={handleSignIn} loading={submitting}>Login</Button>
        </Field>
        <FieldSeparator>Or continue with</FieldSeparator>
        <Field>
          <Button variant="outline" type="button" onClick={handleGoogleSignIn}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" fill="#34A853" />
              <path d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335" />
            </svg>
            Continue with Google
          </Button>
          {fullForm && (
            <FieldDescription className="text-center">
              Don&apos;t have an account?{" "}
              <Link href="/auth/register" className="underline underline-offset-4">
                Sign up
              </Link>
            </FieldDescription>
          )}
        </Field>
      {fullForm && (
        <>
          <FieldSeparator>Or</FieldSeparator>
          <Field>
            <Button variant="outline" type="button" onClick={handleGuestContinue}>
              Continue as Guest
          </Button>
        </Field>
        </>)}
      </FieldGroup>
    </form>
  );
}
