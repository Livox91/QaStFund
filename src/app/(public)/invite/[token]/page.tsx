import type { Metadata } from "next";

import { inspectInvitation } from "@/modules/employee-invitations/infrastructure/invitation-service";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/input";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitationPage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  let invitation;
  try {
    invitation = await inspectInvitation(token);
  } catch {
    invitation = null;
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
      <Card className="w-full max-w-lg">
        <CardContent className="p-8">
          {invitation ? (
            <>
              <p className="text-sm font-semibold text-teal-700">
                Employee invitation
              </p>
              <h1 className="mt-1 text-3xl font-semibold text-slate-950">
                Welcome to {invitation.organizationName}
              </h1>
              <p className="mt-3 text-sm text-slate-600">
                Create your password to activate your organization account.
              </p>
              <form
                action="/api/invitations/accept"
                className="mt-7 space-y-5"
                method="post"
              >
                <input name="token" type="hidden" value={token} />
                <input name="email" type="hidden" value={invitation.email} />
                <Field htmlFor="invitedEmail" label="Email">
                  <Input disabled id="invitedEmail" value={invitation.email} />
                </Field>
                <Field htmlFor="password" label="Create password">
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
                <Field htmlFor="confirmPassword" label="Confirm password">
                  <Input
                    autoComplete="new-password"
                    id="confirmPassword"
                    maxLength={128}
                    name="confirmPassword"
                    required
                    type="password"
                  />
                </Field>
                <Button className="w-full" size="lg" type="submit">
                  Create account
                </Button>
              </form>
              <p className="mt-4 text-xs text-slate-500">
                Invitation expires {invitation.expiresAt.toLocaleString()}.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-slate-950">
                Invitation unavailable
              </h1>
              <p className="mt-3 text-sm text-slate-600">
                This invitation is invalid, expired, accepted, or revoked. Ask
                your employer to resend it.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
