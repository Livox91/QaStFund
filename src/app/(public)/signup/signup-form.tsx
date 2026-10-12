"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  validateEmployerSignup,
  type EmployerSignupFieldErrors,
} from "@/modules/auth/ui/employer-signup-validation";
import { Button } from "@/shared/ui/button";
import { Field, Input } from "@/shared/ui/input";

type SignupResponse = {
  error?: { code?: string; message?: string };
};

export function EmployerSignupForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<EmployerSignupFieldErrors>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    const form = new FormData(event.currentTarget);
    const validation = validateEmployerSignup({
      organizationName: String(form.get("organizationName") ?? ""),
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    });
    if (!validation.success) {
      setFieldErrors(validation.errors);
      setError("Review the highlighted fields and try again.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/auth/employer-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.data),
      });
      const payload = (await response.json()) as SignupResponse;
      if (!response.ok) {
        setError(
          payload.error?.code === "REGISTRATION_CONFLICT"
            ? "An account or organization with those details already exists."
            : (payload.error?.message ??
                "Your account could not be created. Check the form and try again."),
        );
        return;
      }
      router.replace("/employer/onboarding");
      router.refresh();
    } catch {
      setError("The service is temporarily unavailable. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <Field
        error={fieldErrors.organizationName}
        htmlFor="organizationName"
        label="Organization name"
      >
        <Input
          autoComplete="organization"
          id="organizationName"
          maxLength={120}
          minLength={2}
          name="organizationName"
          required
          error={Boolean(fieldErrors.organizationName)}
        />
      </Field>
      <Field
        error={fieldErrors.name}
        htmlFor="name"
        label="Administrator full name"
      >
        <Input
          autoComplete="name"
          id="name"
          maxLength={100}
          minLength={2}
          name="name"
          required
          error={Boolean(fieldErrors.name)}
        />
      </Field>
      <Field error={fieldErrors.email} htmlFor="email" label="Work email">
        <Input
          autoComplete="email"
          id="email"
          name="email"
          required
          type="email"
          error={Boolean(fieldErrors.email)}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          error={fieldErrors.password}
          hint="At least 12 characters with upper, lower, number, and symbol."
          htmlFor="password"
          label="Password"
        >
          <Input
            autoComplete="new-password"
            id="password"
            maxLength={128}
            minLength={12}
            name="password"
            required
            type="password"
            error={Boolean(fieldErrors.password)}
          />
        </Field>
        <Field
          error={fieldErrors.confirmPassword}
          htmlFor="confirmPassword"
          label="Confirm password"
        >
          <Input
            autoComplete="new-password"
            id="confirmPassword"
            maxLength={128}
            minLength={12}
            name="confirmPassword"
            required
            type="password"
            error={Boolean(fieldErrors.confirmPassword)}
          />
        </Field>
      </div>
      {error ? (
        <p aria-live="polite" className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="w-full" disabled={pending} size="lg" type="submit">
        {pending ? "Creating organization…" : "Create employer account"}
      </Button>
    </form>
  );
}
