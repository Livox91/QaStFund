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

export default async function ProfilePage() {
  const actor = await requireAuthenticatedPageUser();
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
      </main>
    </Layout>
  );
}
