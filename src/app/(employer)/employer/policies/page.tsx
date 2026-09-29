import type { Metadata } from "next";

import { updateLendingPolicyAction } from "@/app/(employer)/employer/policies/actions";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { formatMinorUnits } from "@/modules/ledger/api/wallet-response";
import { getEmployerPolicyForActor } from "@/modules/policies/index.server";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Policies" };

export default async function EmployerPoliciesPage() {
  const actor = await requireEmployerAdminPage();
  const policy = await getEmployerPolicyForActor(actor);
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        description="Configure the rules that govern your organization's lending program."
        eyebrow="Employer portal"
        title="Lending Controls"
      />
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Organization lending policy</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={updateLendingPolicyAction}
            className="grid gap-5 sm:grid-cols-2"
          >
            <label className="flex items-center gap-3">
              <input
                defaultChecked={policy.lendingEnabled}
                name="lendingEnabled"
                type="checkbox"
              />{" "}
              Lending enabled
            </label>
            <label className="flex items-center gap-3">
              <input
                defaultChecked={policy.borrowingEnabled}
                name="borrowingEnabled"
                type="checkbox"
              />{" "}
              Borrowing enabled
            </label>
            <PolicyInput
              defaultValue={formatMinorUnits(policy.maxLoanAmountMinorUnits)}
              label="Maximum single loan (USDC)"
              name="maxLoanAmount"
            />
            <PolicyInput
              defaultValue={formatMinorUnits(
                policy.maxOutstandingDebtMinorUnits,
              )}
              label="Maximum outstanding debt (USDC)"
              name="maxOutstandingDebt"
            />
            <PolicyInput
              defaultValue={policy.maxActiveLoans}
              label="Maximum active loans"
              name="maxActiveLoans"
              type="number"
            />
            <PolicyInput
              defaultValue={(policy.minInterestRateBasisPoints / 100).toFixed(
                2,
              )}
              label="Minimum interest (%)"
              name="minInterestRate"
            />
            <PolicyInput
              defaultValue={(policy.maxInterestRateBasisPoints / 100).toFixed(
                2,
              )}
              label="Maximum interest (%)"
              name="maxInterestRate"
            />
            <PolicyInput
              defaultValue={policy.minTermDays}
              label="Minimum term (days)"
              name="minTermDays"
              type="number"
            />
            <PolicyInput
              defaultValue={policy.maxTermDays}
              label="Maximum term (days)"
              name="maxTermDays"
              type="number"
            />
            <div className="sm:col-span-2">
              <Button type="submit">Save policy</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function PolicyInput({
  defaultValue,
  label,
  name,
  type = "text",
}: {
  defaultValue: string | number;
  label: string;
  name: string;
  type?: string;
}) {
  return (
    <label className="space-y-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <Input
        defaultValue={defaultValue}
        min={type === "number" ? 1 : undefined}
        name={name}
        required
        step={type === "number" ? 1 : "0.01"}
        type={type}
      />
    </label>
  );
}
