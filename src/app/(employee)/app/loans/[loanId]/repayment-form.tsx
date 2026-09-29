"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData, type Address } from "viem";

import {
  employeeLendingEscrowAbi,
  erc20UsdcAbi,
} from "@/integrations/arc/employee-lending-escrow";
import { useCircleWallet } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import { formatUsdc, parseUsdc } from "@/shared/money/usdc";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";

type Phase =
  "idle" | "preparing" | "authorizing" | "processing" | "confirmed" | "failed";

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (body?.error?.code === "INSUFFICIENT_USDC_BALANCE") {
    return "You don't have enough USDC to repay this loan.";
  }
  if (body?.error?.code === "LOAN_NOT_REPAYABLE") {
    return "This loan has already been repaid or is no longer repayable.";
  }
  return (
    body?.error?.message ?? `Request failed with status ${response.status}`
  );
}

function friendlyWalletError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("reject") ||
    message.includes("denied") ||
    message.includes("cancel")
  ) {
    return "Repayment authorization was cancelled.";
  }
  if (message.includes("balance") || message.includes("insufficient")) {
    return "You don't have enough USDC to repay this loan.";
  }
  return "Repayment could not be completed. Your loan remains active.";
}

function UsdcAmount({ amount }: { amount: bigint | null }) {
  return amount === null ? "—" : `$${formatUsdc(amount)}`;
}

export function RepaymentForm({
  lenderName,
  loanId,
  repaymentBaseUnits,
}: {
  lenderName: string;
  loanId: string;
  repaymentBaseUnits: string;
}) {
  const wallet = useCircleWallet();
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const amountDue = BigInt(repaymentBaseUnits);
  const balance = useMemo(() => {
    try {
      return wallet.onChainBalance === null
        ? null
        : parseUsdc(wallet.onChainBalance);
    } catch {
      return null;
    }
  }, [wallet.onChainBalance]);
  const balanceAfter = balance === null ? null : balance - amountDue;
  const busy =
    phase === "preparing" || phase === "authorizing" || phase === "processing";

  async function repay() {
    if (!wallet.isConnected) {
      setPhase("failed");
      setMessage("Reconnect your wallet before repaying.");
      return;
    }
    if (balance !== null && balance < amountDue) {
      setPhase("failed");
      setMessage("You don't have enough USDC to repay this loan.");
      return;
    }

    try {
      requestId.current ??= crypto.randomUUID();
      setPhase("preparing");
      setMessage("Preparing repayment…");
      const intentResponse = await fetch(
        `/api/loans/${loanId}/repayment-intents`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: requestId.current }),
        },
      );
      if (!intentResponse.ok)
        throw new Error(await readApiError(intentResponse));
      const { intent } = (await intentResponse.json()) as {
        intent: {
          repaymentId: string;
          contractAddress: Address;
          chainLoanId: string;
          usdcAddress: Address;
          repaymentBaseUnits: string;
        };
      };

      setPhase("authorizing");
      setMessage("Awaiting authorization…");
      let transactionHash: `0x${string}`;
      try {
        transactionHash = await wallet.sendUserOperation([
          {
            to: intent.usdcAddress,
            data: encodeFunctionData({
              abi: erc20UsdcAbi,
              functionName: "approve",
              args: [intent.contractAddress, BigInt(intent.repaymentBaseUnits)],
            }),
          },
          {
            to: intent.contractAddress,
            data: encodeFunctionData({
              abi: employeeLendingEscrowAbi,
              functionName: "repayLoan",
              args: [BigInt(intent.chainLoanId)],
            }),
          },
        ]);
      } catch (error) {
        throw new Error(friendlyWalletError(error));
      }

      setPhase("processing");
      setMessage("Repayment processing…");
      const confirmation = await fetch(
        `/api/loans/${loanId}/repayment-intents/${intent.repaymentId}/confirm`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionHash }),
        },
      );
      if (!confirmation.ok) throw new Error(await readApiError(confirmation));

      requestId.current = null;
      setPhase("confirmed");
      setMessage("Confirmed. Your loan is repaid.");
      await wallet.refreshWallet();
      router.push(`/app/loans/${loanId}?repaid=1`);
      router.refresh();
    } catch (error) {
      setPhase("failed");
      setMessage(
        error instanceof Error
          ? error.message
          : "Repayment could not be completed. Your loan remains active.",
      );
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="lg" type="button">
        Repay ${formatUsdc(amountDue)}
      </Button>
      <Dialog
        description="Review the payment before confirming with your passkey."
        footer={
          <>
            <Button
              disabled={busy}
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            {wallet.isConnected ? (
              <Button
                disabled={busy || phase === "confirmed"}
                isLoading={busy}
                onClick={() => void repay()}
                type="button"
              >
                Confirm Repayment
              </Button>
            ) : (
              <Button
                disabled={wallet.isLoading}
                isLoading={wallet.isLoading}
                onClick={() => void wallet.reconnectWallet()}
                type="button"
              >
                Reconnect wallet
              </Button>
            )}
          </>
        }
        onOpenChange={(nextOpen) => {
          if (!busy) setOpen(nextOpen);
        }}
        open={open}
        title="Repay Loan"
      >
        <dl className="grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Amount due</dt>
            <dd className="mt-1 font-semibold text-slate-950">
              <UsdcAmount amount={amountDue} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Your USDC balance</dt>
            <dd className="mt-1 font-semibold text-slate-950">
              <UsdcAmount amount={balance} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">After repayment</dt>
            <dd
              className={`mt-1 font-semibold ${
                balanceAfter !== null && balanceAfter < 0n
                  ? "text-rose-700"
                  : "text-slate-950"
              }`}
            >
              <UsdcAmount amount={balanceAfter} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Payment goes to</dt>
            <dd className="mt-1 font-semibold text-slate-950">{lenderName}</dd>
          </div>
        </dl>
        {message ? (
          <p
            aria-live="polite"
            className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
              phase === "failed"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : phase === "confirmed"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-blue-200 bg-blue-50 text-blue-700"
            }`}
            role={phase === "failed" ? "alert" : "status"}
          >
            {message}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
