import type { Metadata } from "next";
import Link from "next/link";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { formatMinorUnits } from "@/modules/ledger/api/wallet-response";
import { getEmployerOnboardingForActor } from "@/modules/organizations/index.server";
import {
  ErpNextEnableForm,
  InitialEmployeeSyncButton,
  OnboardingPolicyForm,
  OrganizationProfileForm,
} from "@/modules/organizations/ui/employer-onboarding-forms";
import { DEFAULT_LENDING_POLICY } from "@/modules/policies/domain/lending-policy";
import { buttonStyles } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Employer onboarding" };

function date(value: Date | null | undefined) {
  return value ? value.toLocaleString() : "Never";
}

export default async function EmployerOnboardingPage() {
  const setup = await getEmployerOnboardingForActor(
    await requireEmployerAdminPage(),
  );
  const policy = setup.policy ?? DEFAULT_LENDING_POLICY;
  const checklist = [
    ["Organization profile configured", setup.checklist.organizationProfile],
    ["Employer administrator configured", setup.checklist.employerAdmin],
    ["Employee directory available", setup.checklist.employeeDirectory],
    ["Lending policy configured", setup.checklist.lendingPolicy],
    ["Arc testnet configuration available", setup.checklist.blockchainTestnet],
    [
      setup.organization.erpNextEnabled
        ? "ERPNext connected"
        : "ERPNext not required",
      setup.checklist.erpNext,
    ],
  ] as const;
  const complete = checklist.filter(([, done]) => done).length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        description="Complete the organization settings required for an employer pilot. Existing loans and obligations are never changed by this setup flow."
        eyebrow="Employer portal"
        title="Organization setup"
      />

      <Card className="mt-8">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Setup checklist</CardTitle>
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${setup.readyForPilot ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
            >
              {setup.readyForPilot
                ? "Ready for pilot"
                : `${complete} of ${checklist.length} complete`}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            {checklist.map(([label, done]) => (
              <li
                className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm"
                key={label}
              >
                <span
                  aria-hidden
                  className={done ? "text-emerald-700" : "text-slate-400"}
                >
                  {done ? "✓" : "○"}
                </span>
                <span
                  className={
                    done ? "font-medium text-slate-950" : "text-slate-600"
                  }
                >
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. Organization profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              Tenant identifier: {setup.organization.slug}
            </p>
            <OrganizationProfileForm name={setup.organization.name} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Employee directory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              {setup.employeeCount} employee membership
              {setup.employeeCount === 1 ? "" : "s"} currently available.
            </p>
            <ErpNextEnableForm enabled={setup.organization.erpNextEnabled} />
            {setup.organization.erpNextEnabled ? (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <p className="text-sm text-slate-600">
                  Connection:{" "}
                  <strong>
                    {setup.erpNext?.connectionStatus ?? "not configured"}
                  </strong>
                  . Last successful import:{" "}
                  {date(setup.erpNext?.lastSuccessfulSyncAt)}.
                </p>
                {setup.erpNext ? <InitialEmployeeSyncButton /> : null}
                <Link
                  className={buttonStyles({ variant: "outline" })}
                  href="/employer/integrations"
                >
                  Configure ERPNext
                </Link>
                {setup.erpNext?.latestSync?.safeErrorSummary ? (
                  <p className="text-sm text-red-700">
                    {setup.erpNext.latestSync.safeErrorSummary}
                  </p>
                ) : null}
                {setup.erpNext?.latestSync ? (
                  <p className="text-xs text-slate-500">
                    Latest import: {setup.erpNext.latestSync.status}; processed{" "}
                    {setup.erpNext.latestSync.processedCount}, created{" "}
                    {setup.erpNext.latestSync.createdCount}, updated{" "}
                    {setup.erpNext.latestSync.updatedCount}.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                ERPNext is optional. Existing employee memberships remain
                available through the application directory.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>3. Lending policy defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            These are the existing organization policy fields. Saving them
            affects future eligibility checks and does not rewrite existing
            loans or obligations.
          </p>
          <OnboardingPolicyForm
            defaults={{
              lendingEnabled: policy.lendingEnabled,
              borrowingEnabled: policy.borrowingEnabled,
              maxLoanAmount: formatMinorUnits(policy.maxLoanAmountMinorUnits),
              maxOutstandingDebt: formatMinorUnits(
                policy.maxOutstandingDebtMinorUnits,
              ),
              maxActiveLoans: policy.maxActiveLoans,
              minInterestRate: (
                policy.minInterestRateBasisPoints / 100
              ).toFixed(2),
              maxInterestRate: (
                policy.maxInterestRateBasisPoints / 100
              ).toFixed(2),
              minTermDays: policy.minTermDays,
              maxTermDays: policy.maxTermDays,
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
