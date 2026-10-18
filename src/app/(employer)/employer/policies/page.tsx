import type { Metadata } from "next";

import { updateLendingPolicyAction } from "@/app/(employer)/employer/policies/actions";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { formatMinorUnits } from "@/modules/ledger/api/wallet-response";
import { getEmployerPolicyForActor } from "@/modules/policies/index.server";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox, Field, Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Policies" };

export default async function EmployerPoliciesPage() {
  const actor = await requireEmployerAdminPage();
  const policy = await getEmployerPolicyForActor(actor);
  return (
    <main className="app-page app-page-narrow">
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
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-sm font-medium text-slate-700">
              <Checkbox
                defaultChecked={policy.lendingEnabled}
                name="lendingEnabled"
              />{" "}
              Lending enabled
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-sm font-medium text-slate-700">
              <Checkbox
                defaultChecked={policy.borrowingEnabled}
                name="borrowingEnabled"
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
    <Field htmlFor={`policy-${name}`} label={label}>
      <Input
        defaultValue={defaultValue}
        id={`policy-${name}`}
        min={type === "number" ? 1 : undefined}
        name={name}
        required
        step={type === "number" ? 1 : "0.01"}
        type={type}
      />
    </Field>
  );
}
