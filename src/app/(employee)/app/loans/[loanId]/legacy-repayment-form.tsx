"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { parseUsdcCents } from "@/shared/money/usdc";
import { Button } from "@/shared/ui/button";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { Field, Input } from "@/shared/ui/input";

export function LegacyRepaymentForm(
  props: Readonly<{
    loanId: string;
    currency: string;
    remainingAmountMinorUnits: string;
  }>,
) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const remaining = BigInt(props.remainingAmountMinorUnits);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      const parsed = parseUsdcCents(amount).minorUnits;
      if (parsed > remaining)
        throw new Error("Payment exceeds the remaining balance.");
      requestId.current ??= crypto.randomUUID();
      setBusy(true);
      const response = await fetch(`/api/loans/${props.loanId}/repay`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, requestId: requestId.current }),
      });
      const body = (await response.json().catch(() => null)) as {
        repayment?: { id: string };
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.repayment) {
        throw new Error(body?.error?.message ?? "Repayment failed.");
      }
      requestId.current = null;
      setAmount("");
      setMessage("Repayment recorded and allocated to the oldest installment.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repayment failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-slate-600">
        Remaining:{" "}
        <CurrencyDisplay
          amountMinorUnits={remaining}
          currency={props.currency}
        />
      </p>
      <Field
        htmlFor="partial-repayment"
        label="Payment amount"
        hint="You may pay part or all of the remaining balance."
      >
        <Input
          id="partial-repayment"
          inputMode="decimal"
          min="0.01"
          onChange={(event) => setAmount(event.target.value)}
          placeholder="1.50"
          required
          step="0.01"
          type="number"
          value={amount}
        />
      </Field>
      {message ? (
        <p aria-live="polite" className="text-sm text-slate-700">
          {message}
        </p>
      ) : null}
      <Button disabled={busy} isLoading={busy} size="lg" type="submit">
        Record partial repayment
      </Button>
    </form>
  );
}
