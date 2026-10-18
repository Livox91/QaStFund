"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData, type Address } from "viem";

import {
  employeeLendingEscrowAbi,
  erc20UsdcAbi,
} from "@/integrations/arc/employee-lending-escrow";
import { escrowV3Abi } from "@/integrations/arc/escrow-v3";
import { useCircleWallet } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import {
  formatUsdc,
  parseUsdc,
  parseUsdcCents,
  USDC_BASE_UNITS_PER_CENT,
} from "@/shared/money/usdc";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { Field, Input } from "@/shared/ui/input";
import {
  clearPendingOperation,
  readPendingOperation,
  writePendingOperation,
  type BrowserPendingOperation,
} from "@/modules/transactions/browser-pending-operation";

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
  remainingAmountMinorUnits,
  supportsPartialRepayment,
}: {
  lenderName: string;
  loanId: string;
  remainingAmountMinorUnits: string;
  supportsPartialRepayment: boolean;
}) {
  const wallet = useCircleWallet();
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [storedOperation, setStoredOperation] =
    useState<BrowserPendingOperation | null>(null);
  const remainingBalance =
    BigInt(remainingAmountMinorUnits) * USDC_BASE_UNITS_PER_CENT;
  const enteredAmount = useMemo(() => {
    if (!supportsPartialRepayment) return remainingBalance;
    try {
      return parseUsdcCents(amount).baseUnits;
    } catch {
      return null;
    }
  }, [amount, remainingBalance, supportsPartialRepayment]);
  const balance = useMemo(() => {
    try {
      return wallet.onChainBalance === null
        ? null
        : parseUsdc(wallet.onChainBalance);
    } catch {
      return null;
    }
  }, [wallet.onChainBalance]);
  const balanceAfter =
    balance === null || enteredAmount === null ? null : balance - enteredAmount;
  const busy =
    phase === "preparing" || phase === "authorizing" || phase === "processing";

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const stored = readPendingOperation(
        window.localStorage,
        "repayment",
        loanId,
      );
      if (!cancelled && stored) {
        requestId.current = stored.requestId;
        setStoredOperation(stored);
        if (stored.amountBaseUnits) {
          setAmount(formatUsdc(BigInt(stored.amountBaseUnits)));
        }
        setMessage(
          stored.transactionHash
            ? "A submitted repayment is waiting for confirmation. Resume without submitting it again."
            : "An interrupted repayment can be continued.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loanId]);

  async function confirm(repaymentId: string, transactionHash: `0x${string}`) {
    setPhase("processing");
    setMessage("Verifying the submitted repayment…");
    const confirmation = await fetch(
      `/api/loans/${loanId}/repayment-intents/${repaymentId}/confirm`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionHash }),
      },
    );
    if (!confirmation.ok) throw new Error(await readApiError(confirmation));
    const result = (await confirmation.json()) as {
      loan?: { status?: "ACTIVE" | "REPAID" };
    };
    clearPendingOperation(window.localStorage, "repayment", loanId);
    setStoredOperation(null);
    requestId.current = null;
    setPhase("confirmed");
    setMessage(
      result.loan?.status === "REPAID"
        ? "Confirmed. Your loan is repaid."
        : "Confirmed. Your partial payment was recorded.",
    );
    await wallet.refreshWallet();
    router.push(`/app/loans/${loanId}?repaid=1`);
    router.refresh();
  }

  async function repay() {
    if (!wallet.isConnected) {
      setPhase("failed");
      setMessage("Reconnect your wallet before repaying.");
      return;
    }
    const recoverable = readPendingOperation(
      window.localStorage,
      "repayment",
      loanId,
    );
    const paymentAmount = recoverable?.amountBaseUnits
      ? BigInt(recoverable.amountBaseUnits)
      : enteredAmount;
    if (
      paymentAmount === null ||
      paymentAmount <= 0n ||
      paymentAmount > remainingBalance
    ) {
      setPhase("failed");
      setMessage("Enter an amount between $0.01 and the remaining balance.");
      return;
    }
    if (balance !== null && balance < paymentAmount) {
      setPhase("failed");
      setMessage("You don't have enough USDC to repay this loan.");
      return;
    }

    try {
      if (recoverable?.operationId && recoverable.transactionHash) {
        await confirm(recoverable.operationId, recoverable.transactionHash);
        return;
      }
      requestId.current ??= crypto.randomUUID();
      writePendingOperation(window.localStorage, {
        kind: "repayment",
        referenceId: loanId,
        requestId: requestId.current,
        amountBaseUnits: paymentAmount.toString(),
      });
      setPhase("preparing");
      setMessage("Preparing repayment…");
      const intentResponse = await fetch(
        `/api/loans/${loanId}/repayment-intents`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: requestId.current,
            ...(supportsPartialRepayment
              ? { amount: formatUsdc(paymentAmount) }
              : {}),
          }),
        },
      );
      if (!intentResponse.ok)
        throw new Error(await readApiError(intentResponse));
      const { intent } = (await intentResponse.json()) as {
        intent:
          | {
              state: "CONFIRMED";
              repaymentId: string;
              loanId: string;
              loanStatus: "ACTIVE" | "OVERDUE" | "REPAID";
            }
          | {
              state: "PENDING";
              repaymentId: string;
              contractAddress: Address;
              chainLoanId: string;
              usdcAddress: Address;
              repaymentBaseUnits: string;
              repaymentMode: "FULL" | "PARTIAL";
              chainRepaymentId: `0x${string}` | null;
            };
      };
      if (intent.state === "CONFIRMED") {
        clearPendingOperation(window.localStorage, "repayment", loanId);
        setStoredOperation(null);
        requestId.current = null;
        setPhase("confirmed");
        setMessage(
          intent.loanStatus === "REPAID"
            ? "Confirmed. Your loan is repaid."
            : "Confirmed. Your partial payment was recorded.",
        );
        await wallet.refreshWallet();
        router.push(`/app/loans/${loanId}?repaid=1`);
        router.refresh();
        return;
      }

      setStoredOperation(
        writePendingOperation(window.localStorage, {
          kind: "repayment",
          referenceId: loanId,
          requestId: requestId.current,
          operationId: intent.repaymentId,
          amountBaseUnits: paymentAmount.toString(),
        }),
      );

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
          intent.repaymentMode === "PARTIAL" && intent.chainRepaymentId
            ? {
                to: intent.contractAddress,
                data: encodeFunctionData({
                  abi: escrowV3Abi,
                  functionName: "repayLoanPartial",
                  args: [
                    BigInt(intent.chainLoanId),
                    BigInt(intent.repaymentBaseUnits),
                    intent.chainRepaymentId,
                  ],
                }),
              }
            : {
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

      setStoredOperation(
        writePendingOperation(window.localStorage, {
          kind: "repayment",
          referenceId: loanId,
          requestId: requestId.current,
          operationId: intent.repaymentId,
          transactionHash,
          amountBaseUnits: paymentAmount.toString(),
        }),
      );
      await confirm(intent.repaymentId, transactionHash);
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
      <Button
        onClick={() => {
          if (!amount) setAmount(formatUsdc(remainingBalance));
          setOpen(true);
        }}
        size="lg"
        type="button"
      >
        {storedOperation
          ? "Resume repayment"
          : supportsPartialRepayment
            ? "Make a payment"
            : `Repay $${formatUsdc(remainingBalance)}`}
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
                {storedOperation?.transactionHash
                  ? "Resume confirmation"
                  : storedOperation
                    ? "Continue repayment"
                    : "Confirm Repayment"}
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
            <dt className="text-xs text-slate-500">Remaining balance</dt>
            <dd className="mt-1 font-semibold text-slate-950">
              <UsdcAmount amount={remainingBalance} />
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
        {supportsPartialRepayment ? (
          <div className="mt-5">
            <Field
              htmlFor="onchain-repayment-amount"
              label="Payment amount"
              hint="Pay any amount from $0.01 up to the remaining balance."
            >
              <Input
                disabled={busy || Boolean(storedOperation)}
                id="onchain-repayment-amount"
                inputMode="decimal"
                max={formatUsdc(remainingBalance)}
                min="0.01"
                onChange={(event) => setAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={amount}
              />
            </Field>
          </div>
        ) : null}
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
