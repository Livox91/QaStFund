"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData, type Address } from "viem";

import { employeeLendingEscrowAbi } from "@/integrations/arc/employee-lending-escrow";
import { useCircleWallet } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import { friendlyBorrowTransactionError } from "@/modules/loans/domain/onchain-borrow";
import {
  clearPendingOperation,
  readPendingOperation,
  writePendingOperation,
  type BrowserPendingOperation,
} from "@/modules/transactions/browser-pending-operation";
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
  const [storedOperation, setStoredOperation] =
    useState<BrowserPendingOperation | null>(null);
  const busy =
    phase === "preparing" || phase === "authorizing" || phase === "confirming";

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const stored = readPendingOperation(
        window.localStorage,
        "loan_acceptance",
        offerId,
      );
      if (!cancelled && stored) {
        requestId.current = stored.requestId;
        setStoredOperation(stored);
        setMessage(
          stored.transactionHash
            ? "A submitted transaction is waiting for confirmation. Resume safely without submitting it again."
            : "An interrupted borrowing attempt can be continued.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [offerId]);

  async function confirm(loanId: string, transactionHash: `0x${string}`) {
    setPhase("confirming");
    setMessage("Verifying the submitted transaction…");
    const confirmation = await fetch(
      `/api/loans/${loanId}/acceptance/confirm`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionHash }),
      },
    );
    if (!confirmation.ok) throw new Error(await readApiError(confirmation));
    clearPendingOperation(window.localStorage, "loan_acceptance", offerId);
    setStoredOperation(null);
    requestId.current = null;
    await wallet.refreshWallet();
    router.push(`/app?loanCreated=1&loanId=${loanId}`);
    router.refresh();
  }

  async function borrow() {
    if (!wallet.isConnected) {
      setPhase("failed");
      setMessage("Reconnect your wallet before borrowing.");
      return;
    }

    try {
      const recoverable = readPendingOperation(
        window.localStorage,
        "loan_acceptance",
        offerId,
      );
      if (recoverable?.operationId && recoverable.transactionHash) {
        await confirm(recoverable.operationId, recoverable.transactionHash);
        return;
      }
      requestId.current ??= crypto.randomUUID();
      writePendingOperation(window.localStorage, {
        kind: "loan_acceptance",
        referenceId: offerId,
        requestId: requestId.current,
      });
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
        intent:
          | { state: "CONFIRMED"; loanId: string }
          | {
              state: "PENDING";
              loanId: string;
              contractAddress: Address;
              chainOfferId: string;
              authorizationExpiry: string;
              authorizationId: `0x${string}`;
              authorizationSignature: `0x${string}`;
            };
      };
      if (intent.state === "CONFIRMED") {
        clearPendingOperation(window.localStorage, "loan_acceptance", offerId);
        setStoredOperation(null);
        requestId.current = null;
        await wallet.refreshWallet();
        router.push(`/app?loanCreated=1&loanId=${intent.loanId}`);
        router.refresh();
        return;
      }

      setStoredOperation(
        writePendingOperation(window.localStorage, {
          kind: "loan_acceptance",
          referenceId: offerId,
          requestId: requestId.current,
          operationId: intent.loanId,
        }),
      );

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
              args: [
                BigInt(intent.chainOfferId),
                BigInt(intent.authorizationExpiry),
                intent.authorizationId,
                intent.authorizationSignature,
              ],
            }),
          },
        ]);
      } catch (error) {
        throw new Error(friendlyBorrowTransactionError(error));
      }

      setStoredOperation(
        writePendingOperation(window.localStorage, {
          kind: "loan_acceptance",
          referenceId: offerId,
          requestId: requestId.current,
          operationId: intent.loanId,
          transactionHash,
        }),
      );
      await confirm(intent.loanId, transactionHash);
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
          {storedOperation?.transactionHash
            ? "Resume confirmation"
            : storedOperation
              ? "Continue borrowing"
              : "Confirm borrowing"}
        </Button>
      )}
    </div>
  );
}
