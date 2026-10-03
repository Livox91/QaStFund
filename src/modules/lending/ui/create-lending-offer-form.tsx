"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData, type Address, type Hex } from "viem";

import { ARC_USDC_ADDRESS } from "@/integrations/arc/arc-testnet";
import {
  employeeLendingEscrowAbi,
  erc20UsdcAbi,
} from "@/integrations/arc/employee-lending-escrow";
import { useCircleWallet } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import { calculateEstimatedRepayment } from "@/modules/lending/domain/lending-offer";
import { Button } from "@/shared/ui/button";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { Field, Input } from "@/shared/ui/input";
import { parsePercentToBasisPoints, parseUsdcCents } from "@/shared/money/usdc";

type Phase =
  "idle" | "authorizing" | "pending" | "confirming" | "confirmed" | "failed";

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return (
    body?.error?.message ?? `Request failed with status ${response.status}`
  );
}

export function CreateLendingOfferForm({ currency }: { currency: string }) {
  const wallet = useCircleWallet();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [interestRate, setInterestRate] = useState("5.00");
  const [durationDays, setDurationDays] = useState("30");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);

  const preview = useMemo(() => {
    try {
      const principal = parseUsdcCents(amount).minorUnits;
      const basisPoints = parsePercentToBasisPoints(interestRate);
      return {
        principal,
        repayment: calculateEstimatedRepayment(principal, basisPoints),
      };
    } catch {
      return null;
    }
  }, [amount, interestRate]);

  const busy =
    phase === "authorizing" || phase === "pending" || phase === "confirming";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!wallet.isConnected) {
      setPhase("failed");
      setMessage("Reconnect your wallet before funding an offer.");
      return;
    }

    try {
      const days = Number(durationDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new Error("Duration must be between 1 and 365 days.");
      }
      parseUsdcCents(amount);
      parsePercentToBasisPoints(interestRate);
      requestId.current ??= crypto.randomUUID();

      setPhase("authorizing");
      setMessage("Preparing your offer and checking your USDC balance…");
      const intentResponse = await fetch(
        "/api/lending-offers/funding-intents",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: requestId.current,
            amount,
            interestRate,
            durationDays: days,
          }),
        },
      );
      if (!intentResponse.ok)
        throw new Error(await readApiError(intentResponse));
      const { intent } = (await intentResponse.json()) as {
        intent: {
          offerId: string;
          contractAddress: Address;
          principalBaseUnits: string;
          feeRateBasisPoints: number;
          durationSeconds: number;
          requestId: Hex;
        };
      };
      const principal = BigInt(intent.principalBaseUnits);

      setPhase("pending");
      setMessage(
        "Confirm the passkey request. Your USDC will be secured for this offer.",
      );
      const transactionHash = await wallet.sendUserOperation([
        {
          to: ARC_USDC_ADDRESS,
          data: encodeFunctionData({
            abi: erc20UsdcAbi,
            functionName: "approve",
            args: [intent.contractAddress, principal],
          }),
        },
        {
          to: intent.contractAddress,
          data: encodeFunctionData({
            abi: employeeLendingEscrowAbi,
            functionName: "createOffer",
            args: [
              principal,
              BigInt(intent.feeRateBasisPoints),
              BigInt(intent.durationSeconds),
              intent.requestId,
            ],
          }),
        },
      ]);

      setPhase("confirming");
      setMessage("Funding confirmed on Arc. Finalizing your offer…");
      const confirmResponse = await fetch(
        `/api/lending-offers/funding-intents/${intent.offerId}/confirm`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionHash }),
        },
      );
      if (!confirmResponse.ok)
        throw new Error(await readApiError(confirmResponse));

      requestId.current = null;
      setPhase("confirmed");
      setMessage("Your funded lending offer is now active.");
      setAmount("");
      await wallet.refreshWallet();
      router.push("/app/lending?created=1");
      router.refresh();
    } catch (error) {
      setPhase("failed");
      setMessage(
        error instanceof Error ? error.message : "Offer funding failed.",
      );
    }
  }

  return (
    <form className="space-y-5" noValidate onSubmit={submit}>
      {message ? (
        <p
          aria-live="polite"
          className={`rounded-lg border px-4 py-3 text-sm ${
            phase === "failed"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : phase === "confirmed"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-blue-200 bg-blue-50 text-blue-700"
          }`}
          role={phase === "failed" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      {!wallet.isConnected ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            Reconnect your wallet with its passkey before creating an offer.
          </p>
          <Button
            className="mt-3"
            disabled={wallet.isLoading}
            onClick={() => void wallet.reconnectWallet()}
            type="button"
            variant="outline"
          >
            Reconnect wallet
          </Button>
        </div>
      ) : null}

      <Field
        hint="This exact amount will be secured in the lending contract."
        htmlFor="amount"
        label="Amount"
      >
        <Input
          id="amount"
          inputMode="decimal"
          min="0.01"
          onChange={(event) => setAmount(event.target.value)}
          placeholder="100.00"
          required
          step="0.01"
          type="number"
          value={amount}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field htmlFor="interestRate" label="Interest rate (%)">
          <Input
            id="interestRate"
            inputMode="decimal"
            max="100"
            min="0"
            onChange={(event) => setInterestRate(event.target.value)}
            required
            step="0.01"
            type="number"
            value={interestRate}
          />
        </Field>
        <Field htmlFor="durationDays" label="Duration (days)">
          <Input
            id="durationDays"
            inputMode="numeric"
            max="365"
            min="1"
            onChange={(event) => setDurationDays(event.target.value)}
            required
            step="1"
            type="number"
            value={durationDays}
          />
        </Field>
      </div>

      {preview ? (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-slate-500">You provide</p>
            <CurrencyDisplay
              amountMinorUnits={preview.principal}
              currency={currency}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">
              Potential repayment
            </p>
            <CurrencyDisplay
              amountMinorUnits={preview.repayment}
              currency={currency}
            />
          </div>
        </div>
      ) : null}

      <Button
        disabled={busy || !wallet.isConnected}
        isLoading={busy}
        size="lg"
        type="submit"
      >
        Fund lending offer
      </Button>
      <p className="text-xs leading-5 text-slate-500">
        Your passkey authorizes one atomic Arc transaction: approval and funding
        either both succeed or both fail.
      </p>
    </form>
  );
}
