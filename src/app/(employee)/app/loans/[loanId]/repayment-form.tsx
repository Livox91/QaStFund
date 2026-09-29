"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  repayLoanAction,
  type RepayLoanActionState,
} from "@/app/(employee)/app/loans/[loanId]/actions";
import { Button } from "@/shared/ui/button";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { Field, Input } from "@/shared/ui/input";

function parseMinorUnits(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(value.trim());
  if (!match) return null;

  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function RepayButton() {
  const { pending } = useFormStatus();

  return (
    <Button isLoading={pending} size="lg" type="submit">
      Confirm repayment
    </Button>
  );
}

export function RepaymentForm({
  currency,
  fullAmount,
  loanId,
  requestId,
}: {
  currency: string;
  fullAmount: string;
  loanId: string;
  requestId: string;
}) {
  const [amount, setAmount] = useState(fullAmount);
  const [state, action] = useActionState<RepayLoanActionState, FormData>(
    repayLoanAction,
    {},
  );
  const currentBalanceMinorUnits = parseMinorUnits(fullAmount) ?? 0n;
  const repaymentMinorUnits = parseMinorUnits(amount);
  const balanceAfterMinorUnits =
    repaymentMinorUnits !== null &&
    repaymentMinorUnits >= 0n &&
    repaymentMinorUnits <= currentBalanceMinorUnits
      ? currentBalanceMinorUnits - repaymentMinorUnits
      : null;

  return (
    <form action={action}>
      <input name="loanId" type="hidden" value={loanId} />
      <input name="requestId" type="hidden" value={requestId} />
      <dl className="mb-5 grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4">
        <div>
          <dt className="text-xs text-slate-500">Current balance</dt>
          <dd className="mt-1 font-semibold text-slate-950">
            <CurrencyDisplay
              amountMinorUnits={currentBalanceMinorUnits}
              currency={currency}
            />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Balance after</dt>
          <dd className="mt-1 font-semibold text-slate-950">
            {balanceAfterMinorUnits === null ? (
              "—"
            ) : (
              <CurrencyDisplay
                amountMinorUnits={balanceAfterMinorUnits}
                currency={currency}
              />
            )}
          </dd>
        </div>
      </dl>
      <Field
        error={state.fieldErrors?.amount?.[0]}
        hint={`Enter a partial amount or repay the full ${fullAmount} ${currency}.`}
        htmlFor="amount"
        label="Repayment amount"
      >
        <Input
          id="amount"
          inputMode="decimal"
          max={fullAmount}
          min="0.01"
          name="amount"
          onChange={(event) => setAmount(event.target.value)}
          required
          step="0.01"
          type="number"
          value={amount}
        />
      </Field>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <RepayButton />
        <Button
          onClick={() => setAmount(fullAmount)}
          type="button"
          variant="outline"
        >
          Use full amount
        </Button>
      </div>
      {state.message ? (
        <p
          className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
