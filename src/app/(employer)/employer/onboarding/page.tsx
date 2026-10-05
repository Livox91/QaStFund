import type { Metadata } from "next";
import Link from "next/link";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployeeDirectoryDashboardForActor } from "@/modules/employee-directory/index.server";
import {
  ConnectionTestButton,
  EmployeeSyncButton,
  IntegrationConfigurationForm,
} from "@/modules/employee-directory/ui/integration-actions";
import { getEmployerOnboardingForActor } from "@/modules/organizations/index.server";
import { OrganizationProfileForm } from "@/modules/organizations/ui/employer-onboarding-forms";
import { buttonStyles } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Employer onboarding" };

function date(value: Date | null | undefined) {
  return value ? value.toLocaleString() : "Never";
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm">
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}
      >
        {done ? "✓" : "○"}
      </span>
      <span className={done ? "font-medium text-slate-950" : "text-slate-500"}>
        {label}
      </span>
    </li>
  );
}

export default async function EmployerOnboardingPage() {
  const actor = await requireEmployerAdminPage();
  const [setup, directory] = await Promise.all([
    getEmployerOnboardingForActor(actor),
    getEmployeeDirectoryDashboardForActor(actor),
  ]);
  const connected = directory.integration?.connectionStatus === "connected";
  const latest = directory.latestRun;
  const synchronized =
    connected &&
    Boolean(latest && ["success", "partial"].includes(latest.status));
  const ready = connected && synchronized;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        description="Create Account → Connect ERPNext → Sync Employees → Invite Employees → Employer Dashboard"
        eyebrow="Employer onboarding"
        title="Set up your organization"
      />

      <Card className="mt-8">
        <CardContent className="p-5">
          <ol className="grid gap-4 sm:grid-cols-3">
            <Step done label="Organization" />
            <Step done={connected} label="Connect ERPNext" />
            <Step done={synchronized} label="Sync and invite" />
          </ol>
        </CardContent>
      </Card>

      <Card className="mt-6" id="organization">
        <CardHeader>
          <CardTitle>1. Confirm your organization</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
          <OrganizationProfileForm name={setup.organization.name} />
          <dl className="rounded-xl bg-slate-50 p-4 text-sm">
            <dt className="text-slate-500">Administrator</dt>
            <dd className="mt-1 font-semibold text-slate-950">
              {setup.administrator.name}
            </dd>
            <dt className="mt-4 text-slate-500">Email</dt>
            <dd className="mt-1 font-medium break-all text-slate-800">
              {setup.administrator.email}
            </dd>
            <dt className="mt-4 text-slate-500">Organization ID</dt>
            <dd className="mt-1 font-mono text-xs text-slate-600">
              {setup.organization.slug}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card className="mt-6" id="erpnext">
        <CardHeader>
          <CardTitle>2. Connect ERPNext</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm leading-6 text-slate-600">
            Use an ERPNext API user with read-only access to the Employee
            resource. Credentials are encrypted at rest and are never returned
            to the browser after saving.
          </p>
          <IntegrationConfigurationForm
            defaults={
              directory.integration
                ? {
                    baseUrl: directory.integration.baseUrl,
                    apiPath: directory.integration.apiPath,
                    apiVersion: directory.integration.apiVersion,
                    authMethod: directory.integration.authMethod,
                    credentialConfigured:
                      directory.integration.credentialConfigured,
                    timeoutMs: directory.integration.timeoutMs,
                    statusMapping: directory.integration.statusMapping,
                  }
                : undefined
            }
          />
          {directory.configured ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">
                    Connection status: {directory.integration?.connectionStatus}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Last tested {date(directory.integration?.lastTestedAt)}
                  </p>
                </div>
                <ConnectionTestButton />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6" id="employee-sync">
        <CardHeader>
          <CardTitle>3. Sync and invite employees</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!connected ? (
            <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
              Save the ERPNext configuration and pass the connection test before
              synchronizing employees.
            </p>
          ) : (
            <EmployeeSyncButton retry={latest?.status === "failed"} />
          )}
          {latest ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Employees found", latest.retrievedCount],
                ["Employees imported", latest.createdCount],
                ["Employees updated", latest.updatedCount],
                ["Invitations created", latest.invitationCreatedCount],
                ["Invitations sent", latest.invitationSentCount],
                ["Invitation failures", latest.invitationFailureCount],
                ["Needs review", latest.reviewCount],
                ["Employees reactivated", latest.reactivatedCount],
              ].map(([label, value]) => (
                <div className="rounded-xl bg-slate-50 p-4" key={String(label)}>
                  <p className="text-xs font-medium text-slate-500">{label}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {latest?.safeErrorSummary ? (
            <p className="text-sm text-amber-700">{latest.safeErrorSummary}</p>
          ) : null}
        </CardContent>
      </Card>

      {ready ? (
        <section className="mt-6 rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-9">
          <p className="text-sm font-semibold tracking-wide text-teal-300 uppercase">
            Onboarding complete
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Your organization is ready
          </h2>
          <ul className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
            <li>✓ ERPNext connected</li>
            <li>✓ Employee directory synchronized</li>
            <li>✓ Invitations processed</li>
            <li>✓ Employer account ready</li>
          </ul>
          <Link
            className={buttonStyles({
              className: "mt-6 bg-white !text-slate-950 hover:bg-slate-100",
              size: "lg",
            })}
            href="/employer"
          >
            Go to Employer Dashboard
          </Link>
        </section>
      ) : null}
    </main>
  );
}
