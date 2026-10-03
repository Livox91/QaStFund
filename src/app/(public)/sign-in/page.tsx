import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getRoleHome } from "@/modules/auth/domain/application-role";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/input";

export const metadata: Metadata = {
  title: "Sign in",
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "Enter a valid email address and password.",
  invalid_credentials: "Invalid email or password.",
  sign_in_failed: "Unable to sign in right now. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const actor = await getCurrentActor();

  if (actor) {
    redirect(getRoleHome(actor.role));
  }

  const error = (await searchParams).error;
  const errorCode = typeof error === "string" ? error : undefined;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-16 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-teal-50 to-transparent"
      />
      <Card className="relative w-full max-w-md shadow-xl shadow-slate-200/60">
        <CardContent className="p-7 sm:p-9">
          <div className="mb-8">
            <div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold !text-white shadow-sm">
              EL
            </div>
            <p className="text-sm font-semibold text-teal-700">
              Employee Lending Platform
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
              Welcome back
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Sign in with your organization account to continue.
            </p>
          </div>

          {errorCode && ERROR_MESSAGES[errorCode] ? (
            <p
              className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
              role="alert"
            >
              {ERROR_MESSAGES[errorCode]}
            </p>
          ) : null}

          <form action="/api/auth/sign-in" className="space-y-5" method="post">
            <Field htmlFor="email" label="Email address">
              <Input
                autoComplete="email"
                id="email"
                name="email"
                placeholder="you@company.com"
                required
                type="email"
              />
            </Field>
            <Field htmlFor="password" label="Password">
              <Input
                autoComplete="current-password"
                id="password"
                maxLength={128}
                name="password"
                placeholder="Enter your password"
                required
                type="password"
              />
            </Field>
            <Button className="w-full" size="lg" type="submit">
              Sign in
            </Button>
          </form>

          {process.env.NODE_ENV !== "production" ? (
            <div className="mt-8 border-t border-slate-200 pt-6">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Development accounts
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Switch between the two seeded employee identities using the
                normal sign-in flow.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { email: "alice@acme.test", label: "Sign in as Alice" },
                  { email: "bob@acme.test", label: "Sign in as Bob" },
                ].map((account) => (
                  <form
                    action="/api/auth/sign-in"
                    method="post"
                    key={account.email}
                  >
                    <input name="email" type="hidden" value={account.email} />
                    <input
                      name="password"
                      type="hidden"
                      value="AcmeEmployee123!"
                    />
                    <Button className="w-full" type="submit" variant="outline">
                      {account.label}
                    </Button>
                  </form>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
