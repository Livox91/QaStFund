"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  repayLoanAction,
  type RepayLoanActionState,
} from "@/app/(employee)/app/loans/[loanId]/actions";
import { Button } from "@/shared/ui/button";
import { Field, Input } from "@/shared/ui/input";

function RepayButton() {
  const { pending } = useFormStatus();

  return (
    <Button isLoading={pending} size="lg" type="submit">
      Repay
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

  return (
    <form action={action}>
      <input name="loanId" type="hidden" value={loanId} />
      <input name="requestId" type="hidden" value={requestId} />
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
