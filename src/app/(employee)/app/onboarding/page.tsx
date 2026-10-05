import type { Metadata } from "next";
import Link from "next/link";

import { getArcWalletForActor } from "@/modules/arc-wallet/index.server";
import { ArcWalletPanel } from "@/modules/arc-wallet/ui/arc-wallet-panel";
import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployeeOnboardingState } from "@/modules/employees/domain/employee-onboarding";
import { getEmployeeIdentityForActor } from "@/modules/employees/index.server";
import { getBorrowingCapacityForActor } from "@/modules/policies/index.server";
import { buttonStyles } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Employee setup" };

const labels = {
  verified: "Verified",
  eligible: "Eligible",
  ineligible: "Ineligible",
  setup_required: "Setup required",
  pending: "Pending",
  ready: "Ready",
  recovery_required: "Recovery required",
  temporarily_unavailable: "Temporarily unavailable",
} as const;

export default async function EmployeeOnboardingPage() {
  const actor = await requireEmployeePage();
  const [employee, wallet, capacity] = await Promise.all([
    getEmployeeIdentityForActor(actor),
    getArcWalletForActor(actor),
    getBorrowingCapacityForActor(actor),
  ]);
  const setup = getEmployeeOnboardingState({ employee, wallet, capacity });
  const items = [
    ["Account and session", setup.account],
    ["Organization membership", setup.membership],
    ["Employee profile", setup.profile],
    ["Arc wallet", setup.wallet],
    ["Borrowing eligibility", setup.eligibility],
  ] as const;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        description={`Review your account, wallet, and lending access for ${actor.organizationName}.`}
        eyebrow="Employee portal"
        title="Get ready to lend and borrow"
      />
      <Card className="mt-8">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Setup status</CardTitle>
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${setup.readyToUse ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
            >
              {setup.readyToUse ? "Ready to use" : "Action needed"}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map(([name, state]) => (
              <li
                className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"
                key={name}
              >
                <span className="text-sm font-medium text-slate-800">
                  {name}
                </span>
                <span className="text-right text-xs font-semibold text-slate-600">
                  {labels[state]}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
            {setup.nextAction === "browse_offers"
              ? "Setup is complete. You can browse funded offers from eligible coworkers."
              : setup.nextAction === "setup_wallet"
                ? "Set up your wallet with a device passkey before using on-chain lending."
                : setup.nextAction === "recover_wallet"
                  ? "Recover wallet access with your existing passkey to continue."
                  : setup.nextAction === "contact_employer"
                    ? "Your employment or lending eligibility needs employer attention. Historical activity remains available."
                    : "Setup is still processing or temporarily unavailable. You can safely return later."}
          </div>
          {setup.readyToUse ? (
            <Link
              className={`${buttonStyles({ size: "lg" })} mt-5`}
              href="/app/borrow"
            >
              Browse offers
            </Link>
          ) : null}
        </CardContent>
      </Card>
      <ArcWalletPanel employee={employee} />
    </main>
  );
}
