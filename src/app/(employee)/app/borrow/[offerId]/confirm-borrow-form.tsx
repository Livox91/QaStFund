"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  confirmBorrowOfferAction,
  type ConfirmBorrowOfferActionState,
} from "@/app/(employee)/app/borrow/[offerId]/actions";
import { Button } from "@/shared/ui/button";

function ConfirmButton() {
  const { pending } = useFormStatus();

  return (
    <Button isLoading={pending} size="lg" type="submit">
      Confirm and create loan
    </Button>
  );
}

export function ConfirmBorrowForm({
  amount,
  offerId,
  requestId,
}: {
  amount: string;
  offerId: string;
  requestId: string;
}) {
  const [state, action] = useActionState<
    ConfirmBorrowOfferActionState,
    FormData
  >(confirmBorrowOfferAction, {});

  return (
    <form action={action}>
      <input name="amount" type="hidden" value={amount} />
      <input name="offerId" type="hidden" value={offerId} />
      <input name="requestId" type="hidden" value={requestId} />
      {state.message ? (
        <p
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
      <ConfirmButton />
    </form>
  );
}
