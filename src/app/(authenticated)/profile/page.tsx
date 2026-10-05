import type { Metadata } from "next";
import Link from "next/link";

import {
  ApplicationRole,
  getRoleHome,
} from "@/modules/auth/domain/application-role";
import { requireAuthenticatedPageUser } from "@/modules/auth/infrastructure/auth-guard";
import { buttonStyles } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { EmployeeLayout } from "@/shared/ui/layouts/employee-layout";
import { EmployerLayout } from "@/shared/ui/layouts/employer-layout";
import { StatusDisplay } from "@/shared/ui/status-display";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage({
  searchParams,
}: PageProps<"/profile">) {
  const actor = await requireAuthenticatedPageUser();
  const passwordResult = (await searchParams).password;
  const Layout =
    actor.role === ApplicationRole.EMPLOYER_ADMIN
      ? EmployerLayout
      : EmployeeLayout;

  return (
    <Layout actor={actor}>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-teal-700">Account</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
              Profile
            </h1>
          </div>
          <Link
            className={buttonStyles({ variant: "outline" })}
            href={getRoleHome(actor.role)}
          >
            Back to dashboard
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Account details</CardTitle>
            <CardDescription>
              Your verified identity and organization membership.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-slate-500">Name</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-950">
                  {actor.name}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">Email</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-950">
                  {actor.email}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Organization
                </dt>
                <dd className="mt-1 text-sm font-semibold text-slate-950">
                  {actor.organizationName}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">Role</dt>
                <dd className="mt-1">
                  <StatusDisplay status={actor.role} />
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Use your current password to protect this account change. Other
              sessions will be signed out.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {passwordResult === "changed" ? (
              <p className="mb-4 text-sm text-emerald-700">
                Password changed successfully.
              </p>
            ) : passwordResult === "failed" ? (
              <p className="mb-4 text-sm text-rose-700">
                Password could not be changed. Check your current password and
                requirements.
              </p>
            ) : null}
            <form
              action="/api/auth/change-password"
              className="grid gap-4 sm:max-w-md"
              method="post"
            >
              <label className="text-sm font-medium text-slate-700">
                Current password
                <input
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  name="currentPassword"
                  required
                  type="password"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                New password
                <input
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  maxLength={128}
                  minLength={12}
                  name="newPassword"
                  required
                  type="password"
                />
              </label>
              <p className="text-xs text-slate-500">
                Use 12–128 characters with uppercase, lowercase, number, and
                symbol characters.
              </p>
              <label className="text-sm font-medium text-slate-700">
                Confirm new password
                <input
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  maxLength={128}
                  name="confirmPassword"
                  required
                  type="password"
                />
              </label>
              <button
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold !text-white"
                type="submit"
              >
                Change password
              </button>
            </form>
          </CardContent>
        </Card>
      </main>
    </Layout>
  );
}
