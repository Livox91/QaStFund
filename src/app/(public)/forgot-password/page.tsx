import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/input";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({
  searchParams,
}: PageProps<"/forgot-password">) {
  const sent = (await searchParams).sent === "1";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <h1 className="text-3xl font-semibold text-slate-950">
            Reset your password
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Enter your account email. If it is eligible, we’ll send a secure
            reset link.
          </p>
          {sent ? (
            <p className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              If an eligible account exists, a reset email has been sent.
            </p>
          ) : null}
          <form
            action="/api/auth/forgot-password"
            className="mt-6 space-y-5"
            method="post"
          >
            <Field htmlFor="email" label="Email">
              <Input
                autoComplete="email"
                id="email"
                name="email"
                required
                type="email"
              />
            </Field>
            <Button className="w-full" type="submit">
              Send reset link
            </Button>
          </form>
          <Link
            className="mt-5 inline-block text-sm font-medium text-teal-700"
            href="/sign-in"
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
