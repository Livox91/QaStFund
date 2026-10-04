"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  initialEmployeeSyncAction,
  updateErpNextEnabledAction,
  updateOnboardingPolicyAction,
  updateOrganizationProfileAction,
  type OnboardingActionState,
} from "@/app/(employer)/employer/onboarding/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

const initialState: OnboardingActionState = { status: "idle", message: "" };

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} type="submit">
      {pending ? "Saving…" : children}
    </Button>
  );
}

function Result({ state }: { state: OnboardingActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      aria-live="polite"
      className={
        state.status === "error"
          ? "text-sm text-red-700"
          : "text-sm text-emerald-700"
      }
    >
      {state.message}
    </p>
  );
}

export function OrganizationProfileForm({ name }: { name: string }) {
  const [state, action] = useActionState(
    updateOrganizationProfileAction,
    initialState,
  );
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium text-slate-700">
        Organization name
        <Input
          className="mt-1"
          defaultValue={name}
          maxLength={120}
          minLength={2}
          name="organizationName"
          required
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save organization</SubmitButton>
        <Result state={state} />
      </div>
    </form>
  );
}

export function ErpNextEnableForm({ enabled }: { enabled: boolean }) {
  const [state, action] = useActionState(
    updateErpNextEnabledAction,
    initialState,
  );
  return (
    <form action={action} className="space-y-4">
      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input
          className="mt-1"
          defaultChecked={enabled}
          name="erpNextEnabled"
          type="checkbox"
        />
        <span>
          <strong className="block text-slate-950">
            Enable ERPNext employee import
          </strong>
          Keep this off when employees are managed through the existing
          application directory.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save ERPNext preference</SubmitButton>
        <Result state={state} />
      </div>
    </form>
  );
}

export type PolicyFormDefaults = {
  lendingEnabled: boolean;
  borrowingEnabled: boolean;
  maxLoanAmount: string;
  maxOutstandingDebt: string;
  maxActiveLoans: number;
  minInterestRate: string;
  maxInterestRate: string;
  minTermDays: number;
  maxTermDays: number;
};

export function OnboardingPolicyForm({
  defaults,
}: {
  defaults: PolicyFormDefaults;
}) {
  const [state, action] = useActionState(
    updateOnboardingPolicyAction,
    initialState,
  );
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Toggle
        defaultChecked={defaults.lendingEnabled}
        label="Lending enabled"
        name="lendingEnabled"
      />
      <Toggle
        defaultChecked={defaults.borrowingEnabled}
        label="Borrowing enabled"
        name="borrowingEnabled"
      />
      <Field
        defaultValue={defaults.maxLoanAmount}
        label="Maximum single loan (USDC)"
        name="maxLoanAmount"
      />
      <Field
        defaultValue={defaults.maxOutstandingDebt}
        label="Maximum outstanding debt (USDC)"
        name="maxOutstandingDebt"
      />
      <Field
        defaultValue={defaults.maxActiveLoans}
        label="Maximum active loans"
        name="maxActiveLoans"
        type="number"
      />
      <Field
        defaultValue={defaults.minInterestRate}
        label="Minimum interest (%)"
        name="minInterestRate"
      />
      <Field
        defaultValue={defaults.maxInterestRate}
        label="Maximum interest (%)"
        name="maxInterestRate"
      />
      <Field
        defaultValue={defaults.minTermDays}
        label="Minimum term (days)"
        name="minTermDays"
        type="number"
      />
      <Field
        defaultValue={defaults.maxTermDays}
        label="Maximum term (days)"
        name="maxTermDays"
        type="number"
      />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <SubmitButton>Save lending policy</SubmitButton>
        <Result state={state} />
      </div>
    </form>
  );
}

export function InitialEmployeeSyncButton() {
  const [state, action] = useActionState(
    initialEmployeeSyncAction,
    initialState,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton>Import employees now</SubmitButton>
      <Result state={state} />
    </form>
  );
}

function Toggle({
  defaultChecked,
  label,
  name,
}: {
  defaultChecked: boolean;
  label: string;
  name: string;
}) {
  return (
    <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
      <input defaultChecked={defaultChecked} name={name} type="checkbox" />
      {label}
    </label>
  );
}

function Field({
  defaultValue,
  label,
  name,
  type = "text",
}: {
  defaultValue: string | number;
  label: string;
  name: string;
  type?: "text" | "number";
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <Input
        className="mt-1"
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
