import type { Metadata } from "next";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/input";

export const metadata: Metadata = { title: "Reset password" };
export default async function ResetPasswordPage({
  params,
}: PageProps<"/reset-password/[token]">) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <h1 className="text-3xl font-semibold text-slate-950">
            Choose a new password
          </h1>
          <form
            action="/api/auth/reset-password"
            className="mt-6 space-y-5"
            method="post"
          >
            <input name="token" type="hidden" value={token} />
            <Field htmlFor="password" label="New password">
              <Input
                autoComplete="new-password"
                id="password"
                maxLength={128}
                minLength={12}
                name="password"
                required
                type="password"
              />
            </Field>
            <p className="text-xs text-slate-500">
              Use 12–128 characters with uppercase, lowercase, number, and
              symbol characters.
            </p>
            <Field htmlFor="confirmPassword" label="Confirm new password">
              <Input
                autoComplete="new-password"
                id="confirmPassword"
                maxLength={128}
                name="confirmPassword"
                required
                type="password"
              />
            </Field>
            <Button className="w-full" type="submit">
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
