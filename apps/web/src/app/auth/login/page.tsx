"use client";

import { LoginForm } from "@/components/login-form";
import { BrandMark } from "@/components/brand";

export default function LoginPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm space-y-6">
        <BrandMark className="justify-center text-xl" />
        <LoginForm />
      </div>
    </div>
  );
}
