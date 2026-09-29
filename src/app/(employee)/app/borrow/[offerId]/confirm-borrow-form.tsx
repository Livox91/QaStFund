"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData, type Address } from "viem";

import { employeeLendingEscrowAbi } from "@/integrations/arc/employee-lending-escrow";
import { useCircleWallet } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import { friendlyBorrowTransactionError } from "@/modules/loans/domain/onchain-borrow";
import { Button } from "@/shared/ui/button";

type Phase = "idle" | "preparing" | "authorizing" | "confirming" | "failed";

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return (
    body?.error?.message ?? `Request failed with status ${response.status}`
  );
}

export function ConfirmBorrowForm({ offerId }: { offerId: string }) {
  const wallet = useCircleWallet();
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const busy =
    phase === "preparing" || phase === "authorizing" || phase === "confirming";

  async function borrow() {
    if (!wallet.isConnected) {
      setPhase("failed");
      setMessage("Reconnect your wallet before borrowing.");
      return;
    }

    try {
      requestId.current ??= crypto.randomUUID();
      setPhase("preparing");
      setMessage("Checking that this offer is still available…");
      const intentResponse = await fetch(
        `/api/lending-offers/${offerId}/acceptance-intents`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: requestId.current }),
        },
      );
      if (!intentResponse.ok) {
        throw new Error(await readApiError(intentResponse));
      }
      const { intent } = (await intentResponse.json()) as {
        intent: {
          loanId: string;
          contractAddress: Address;
          chainOfferId: string;
        };
      };

      setPhase("authorizing");
      setMessage("Confirm with your passkey to receive the funds.");
      let transactionHash;
      try {
        transactionHash = await wallet.sendUserOperation([
          {
            to: intent.contractAddress,
            data: encodeFunctionData({
              abi: employeeLendingEscrowAbi,
              functionName: "acceptOffer",
              args: [BigInt(intent.chainOfferId)],
            }),
          },
        ]);
      } catch (error) {
        throw new Error(friendlyBorrowTransactionError(error));
      }

      setPhase("confirming");
      setMessage("Funds received. Activating your loan…");
      const confirmation = await fetch(
        `/api/loans/${intent.loanId}/acceptance/confirm`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionHash }),
        },
      );
      if (!confirmation.ok) throw new Error(await readApiError(confirmation));

      requestId.current = null;
      await wallet.refreshWallet();
      router.push(`/app?loanCreated=1&loanId=${intent.loanId}`);
      router.refresh();
    } catch (error) {
      setPhase("failed");
      setMessage(
        error instanceof Error
          ? error.message
          : "This offer is no longer available. Choose another lending offer.",
      );
    }
  }

  return (
    <div>
      {message ? (
        <p
          aria-live="polite"
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            phase === "failed"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-blue-200 bg-blue-50 text-blue-700"
          }`}
          role={phase === "failed" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      {!wallet.isConnected ? (
        <Button
          disabled={wallet.isLoading}
          onClick={() => void wallet.reconnectWallet()}
          size="lg"
          type="button"
          variant="outline"
        >
          Reconnect wallet
        </Button>
      ) : (
        <Button
          disabled={busy}
          isLoading={busy}
          onClick={() => void borrow()}
          size="lg"
          type="button"
        >
          Confirm borrowing
        </Button>
      )}
    </div>
  );
}
