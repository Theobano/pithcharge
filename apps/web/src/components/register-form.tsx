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
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/components/ui/toast";

export function RegisterForm({
  fullForm = true,
  className,
  ...props
}: {
  fullForm?: boolean;
} & React.ComponentProps<"form">) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSignUp = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (submitting || !email || !password) return;
    if (password != confirmPassword) {
      toast.add({
        type: "error",
        description: "Passwords do not match"
      })
      return
    }
    setSubmitting(true);
    await authClient.signUp.email(
      {
        name: `${firstName.trim()} ${lastName.trim()}`,
        email,
        password,
      },
      {
        onSuccess: () => {
          toast.add({
            type: "success",
            description: "Account created successfully",
          });
          router.push("/chargers");
        },
        onError: (ctx) => {
          console.log(ctx);
          toast.add({
            type: "error",
            description: ctx.error.message,
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

  const handleGuestContinue = (e: React.FormEvent) => {
    e.preventDefault();
    authClient.signIn.anonymous({}, {
      onSuccess: () => {
        
        router.push("/chargers");
      },
      onError: (ctx) => {
        toast.add({
            type: "error",
            description: ctx.error.message,
          });
      }
    })
  };

  return (
    <form className={cn("flex flex-col gap-6", className)} {...props} onSubmit={handleSignUp}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Create your account</h1>
          <p className="text-sm text-balance text-muted-foreground">
            Complete the form below to get started
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor="firstname">First Name</FieldLabel>
          <Input
            id="firstname"
            type="text"
            placeholder="John"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="surname">Last Name</FieldLabel>
          <Input
            id="surname"
            type="text"
            placeholder="Doe"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            placeholder="m@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>

          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password2">Confirm Password</FieldLabel>

          <Input
            id="password2"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </Field>
        <Field>
          <Button type="submit" loading={submitting}>Create Account</Button>
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
              Already have an account?{" "}
              <a href="#" className="underline underline-offset-4">
                Sign in
              </a>
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
          </>
        )}
      </FieldGroup>
    </form>
  );
}
