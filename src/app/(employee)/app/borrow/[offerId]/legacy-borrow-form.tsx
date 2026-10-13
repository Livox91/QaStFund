"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { calculateEstimatedRepayment } from "@/modules/lending/domain/lending-offer";
import { generateRepaymentSchedule } from "@/modules/repayment-plans/domain/repayment-plan";
import { parseUsdcCents } from "@/shared/money/usdc";
import { Button } from "@/shared/ui/button";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { Field, Input } from "@/shared/ui/input";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function LegacyBorrowForm(
  props: Readonly<{
    offerId: string;
    currency: string;
    availableAmountMinorUnits: string;
    minimumLoanAmountMinorUnits: string;
    maximumLoanAmountMinorUnits: string;
    feeRateBasisPoints: number;
    durationDays: number;
  }>,
) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [amount, setAmount] = useState("");
  const [termMonths, setTermMonths] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const permittedTerms = Math.min(
    3,
    Math.max(1, Math.ceil(props.durationDays / 30)),
  );

  const preview = useMemo(() => {
    try {
      const principal = parseUsdcCents(amount).minorUnits;
      const minimum = BigInt(props.minimumLoanAmountMinorUnits);
      const maximum = BigInt(props.maximumLoanAmountMinorUnits);
      const available = BigInt(props.availableAmountMinorUnits);
      if (principal < minimum || principal > maximum || principal > available) {
        return null;
      }
      const total = calculateEstimatedRepayment(
        principal,
        props.feeRateBasisPoints,
      );
      return {
        principal,
        total,
        fee: total - principal,
        schedule: generateRepaymentSchedule({
          totalRepaymentMinorUnits: total,
          termMonths,
          originatedAt: new Date(),
        }),
      };
    } catch {
      return null;
    }
  }, [amount, props, termMonths]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) {
      setMessage("Enter an amount within this offer's available limits.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      requestId.current ??= crypto.randomUUID();
      const response = await fetch(
        `/api/lending-offers/${props.offerId}/borrow`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            termMonths,
            requestId: requestId.current,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        loan?: { id: string };
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.loan) {
        throw new Error(body?.error?.message ?? "Loan acceptance failed.");
      }
      requestId.current = null;
      router.push(`/app?loanCreated=1&loanId=${body.loan.id}`);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Loan acceptance failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {message ? (
        <p
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          role="alert"
        >
          {message}
        </p>
      ) : null}
      <Field
        htmlFor="borrow-amount"
        label="Amount to borrow"
        hint="The remaining offer stays available for another eligible borrower."
      >
        <Input
          id="borrow-amount"
          inputMode="decimal"
          min="0.01"
          onChange={(event) => setAmount(event.target.value)}
          placeholder="4.00"
          required
          step="0.01"
          type="number"
          value={amount}
        />
      </Field>
      <Field htmlFor="repayment-term" label="Repayment duration">
        <select
          className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          id="repayment-term"
          onChange={(event) =>
            setTermMonths(Number(event.target.value) as 1 | 2 | 3)
          }
          value={termMonths}
        >
          {([1, 2, 3] as const).slice(0, permittedTerms).map((term) => (
            <option key={term} value={term}>
              {term} month{term === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </Field>
      {preview ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-slate-500">Principal</dt>
              <dd>
                <CurrencyDisplay
                  amountMinorUnits={preview.principal}
                  currency={props.currency}
                />
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Interest / fee</dt>
              <dd>
                <CurrencyDisplay
                  amountMinorUnits={preview.fee}
                  currency={props.currency}
                />
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Installments</dt>
              <dd className="font-medium">{preview.schedule.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Total repayment</dt>
              <dd>
                <CurrencyDisplay
                  amountMinorUnits={preview.total}
                  currency={props.currency}
                />
              </dd>
            </div>
          </dl>
          <ol className="space-y-2 border-t border-slate-200 pt-3">
            {preview.schedule.map((installment) => (
              <li
                className="flex justify-between gap-4"
                key={installment.sequence}
              >
                <span>
                  Installment {installment.sequence} ·{" "}
                  {dateFormatter.format(installment.dueAt)}
                </span>
                <CurrencyDisplay
                  amountMinorUnits={installment.amountMinorUnits}
                  currency={props.currency}
                />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <Button
        disabled={busy || !preview}
        isLoading={busy}
        size="lg"
        type="submit"
      >
        Confirm exact amount and schedule
      </Button>
    </form>
  );
}
