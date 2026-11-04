"use client";

import { RegisterForm } from "@/components/register-form";

export default function RegisterPage() {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <RegisterForm />
      </div>
    </div>
  );
}
