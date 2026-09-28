"use client";

import { useActionState } from "react";

import {
  createLendingOfferAction,
  type CreateLendingOfferActionState,
} from "@/app/(employee)/app/lending/actions";
import { Button } from "@/shared/ui/button";
import { Field, Input } from "@/shared/ui/input";

const initialState: CreateLendingOfferActionState = {};

export function CreateLendingOfferForm({
  currency,
  minimumExpirationDate,
}: {
  currency: string;
  minimumExpirationDate: string;
}) {
  const [state, formAction, pending] = useActionState(
    createLendingOfferAction,
    initialState,
  );
  const error = (field: keyof NonNullable<typeof state.fieldErrors>) =>
    state.fieldErrors?.[field]?.[0];

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}

      <Field
        error={error("amountAvailable")}
        hint={`Total ${currency} committed to this offer.`}
        htmlFor="amountAvailable"
        label="Amount available"
      >
        <Input
          error={Boolean(error("amountAvailable"))}
          id="amountAvailable"
          inputMode="decimal"
          min="0.01"
          name="amountAvailable"
          placeholder="500.00"
          required
          step="0.01"
          type="number"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          error={error("minimumLoanAmount")}
          htmlFor="minimumLoanAmount"
          label="Minimum loan amount"
        >
          <Input
            error={Boolean(error("minimumLoanAmount"))}
            id="minimumLoanAmount"
            inputMode="decimal"
            min="0.01"
            name="minimumLoanAmount"
            placeholder="50.00"
            required
            step="0.01"
            type="number"
          />
        </Field>
        <Field
          error={error("maximumLoanAmount")}
          htmlFor="maximumLoanAmount"
          label="Maximum loan amount"
        >
          <Input
            error={Boolean(error("maximumLoanAmount"))}
            id="maximumLoanAmount"
            inputMode="decimal"
            min="0.01"
            name="maximumLoanAmount"
            placeholder="250.00"
            required
            step="0.01"
            type="number"
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          error={error("durationDays")}
          hint="Maximum term offered to a borrower."
          htmlFor="durationDays"
          label="Duration (days)"
        >
          <Input
            defaultValue="30"
            error={Boolean(error("durationDays"))}
            id="durationDays"
            inputMode="numeric"
            max="365"
            min="1"
            name="durationDays"
            required
            step="1"
            type="number"
          />
        </Field>
        <Field
          error={error("feeRatePercent")}
          hint="Percentage applied to each accepted loan."
          htmlFor="feeRatePercent"
          label="Interest / fee rate (%)"
        >
          <Input
            defaultValue="5.00"
            error={Boolean(error("feeRatePercent"))}
            id="feeRatePercent"
            inputMode="decimal"
            max="100"
            min="0"
            name="feeRatePercent"
            required
            step="0.01"
            type="number"
          />
        </Field>
      </div>

      <Field
        error={error("expirationDate")}
        hint="The offer leaves the marketplace after this date."
        htmlFor="expirationDate"
        label="Expiration date"
      >
        <Input
          error={Boolean(error("expirationDate"))}
          id="expirationDate"
          min={minimumExpirationDate}
          name="expirationDate"
          required
          type="date"
        />
      </Field>

      <Button
        className="w-full sm:w-auto"
        disabled={pending}
        isLoading={pending}
        size="lg"
        type="submit"
      >
        Create Lending Offer
      </Button>
    </form>
  );
}
