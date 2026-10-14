"use client";

import { useEffect, useMemo, useState } from "react";
import {
  decodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_USDC_ADDRESS,
  ARC_USDC_DECIMALS,
} from "@/integrations/arc/arc-testnet";
import { useCircleWallet } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import { Badge, type BadgeTone } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/input";

type Transfer = Readonly<{
  id: string;
  status:
    | "DRAFT"
    | "AWAITING_CONFIRMATION"
    | "SUBMITTED"
    | "CONFIRMED"
    | "FAILED"
    | "UNKNOWN";
  senderAddress: string;
  recipientAddress: string;
  amount: string;
  amountBaseUnits: string;
  chainId: number;
  network: "Arc Testnet";
  token: "USDC";
  tokenAddress: string;
  userOperationHash: string | null;
  transactionHash: string | null;
  explorerUrl: string | null;
  errorCode: string | null;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
}>;

type PreparedTransfer = Readonly<{
  transfer: Transfer;
  call: { to: Address; data: Hex; value: string };
  selfTransfer: boolean;
  availableBalance: string;
  fee: { kind: "SPONSORED"; amount: "0"; token: "USDC" };
}>;

function shortAddress(address: string) {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  const body = (await response.json().catch(() => null)) as
    T | { error?: { message?: string } } | null;
  if (!response.ok) {
    throw new Error(
      (body as { error?: { message?: string } } | null)?.error?.message ??
        `Request failed with status ${response.status}`,
    );
  }
  return body as T;
}

function statusTone(status: Transfer["status"]): BadgeTone {
  if (status === "CONFIRMED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "UNKNOWN") return "warning";
  return "info";
}

function isUserRejection(error: unknown) {
  if (!(error instanceof Error)) return false;
  const value = `${error.name} ${error.message}`.toLowerCase();
  return (
    value.includes("notallowed") ||
    value.includes("reject") ||
    value.includes("cancel")
  );
}

export function SendUsdcFlow({
  initialTransferId,
}: {
  initialTransferId?: string;
}) {
  const wallet = useCircleWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => {
    let recipientError: string | null = null;
    let amountError: string | null = null;
    if (recipient && (!isAddress(recipient) || /^0x0{40}$/i.test(recipient))) {
      recipientError = "Enter a valid, non-zero EVM address.";
    }
    if (amount) {
      try {
        const value = parseUnits(amount, ARC_USDC_DECIMALS);
        if (value <= 0n) amountError = "Amount must be greater than zero.";
        else if (
          wallet.onChainBalance !== null &&
          value > parseUnits(wallet.onChainBalance, ARC_USDC_DECIMALS)
        ) {
          amountError = "Amount exceeds your current USDC balance.";
        }
      } catch {
        amountError =
          "Use a positive amount with no more than 6 decimal places.";
      }
    }
    return { recipientError, amountError };
  }, [amount, recipient, wallet.onChainBalance]);

  const loadTransfer = async (id: string) => {
    const body = await api<{ transfer: Transfer }>(
      `/api/wallet/arc/transfers/${id}`,
    );
    setTransfer(body.transfer);
    return body.transfer;
  };

  const resumeSubmitted = async (id: string, userOperationHash: Hex) => {
    await api(`/api/wallet/arc/transfers/${id}/submit`, {
      method: "POST",
      body: JSON.stringify({ userOperationHash }),
    });
    try {
      const transactionHash =
        await wallet.waitForUserOperation(userOperationHash);
      const body = await api<{ transfer: Transfer }>(
        `/api/wallet/arc/transfers/${id}/confirm`,
        { method: "POST", body: JSON.stringify({ transactionHash }) },
      );
      setTransfer(body.transfer);
      localStorage.removeItem(`qastfund:arc-transfer:${id}`);
    } catch {
      await loadTransfer(id);
    }
  };

  useEffect(() => {
    if (!initialTransferId) return;
    let cancelled = false;
    void api<{ transfer: Transfer }>(
      `/api/wallet/arc/transfers/${initialTransferId}`,
    )
      .then((body) => {
        if (cancelled) return;
        const loaded = body.transfer;
        setTransfer(loaded);
        const saved = localStorage.getItem(
          `qastfund:arc-transfer:${initialTransferId}`,
        );
        if (
          saved &&
          !loaded.userOperationHash &&
          loaded.status === "AWAITING_CONFIRMATION"
        ) {
          return resumeSubmitted(initialTransferId, saved as Hex);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "Unable to load transfer.",
          );
      });
    return () => {
      cancelled = true;
    };
    // Resume only when the URL identifies a different intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTransferId]);

  useEffect(() => {
    if (!transfer || !["SUBMITTED", "UNKNOWN"].includes(transfer.status))
      return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void loadTransfer(transfer.id).catch(() => undefined);
      if (attempts >= 20) window.clearInterval(timer);
    }, 3_000);
    return () => window.clearInterval(timer);
    // Polling key is intentionally the persisted operation identity and status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.id, transfer?.status]);

  const review = async () => {
    setError(null);
    const inputError = validation.recipientError ?? validation.amountError;
    if (!recipient || !amount || inputError) {
      setError(inputError ?? "Recipient and amount are required.");
      return;
    }
    setIsBusy(true);
    try {
      const body = await api<PreparedTransfer>("/api/wallet/arc/transfers", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          recipient,
          amount,
          chainId: ARC_TESTNET_CHAIN_ID,
          tokenAddress: ARC_USDC_ADDRESS,
        }),
      });
      setPrepared(body);
      window.history.replaceState(
        null,
        "",
        `/app/wallet/send?transfer=${body.transfer.id}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to review transfer.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const confirm = async () => {
    if (!prepared) return;
    setError(null);
    setIsBusy(true);
    try {
      if (!wallet.isConnected) {
        throw new Error(
          "Reconnect your wallet before confirming the transfer.",
        );
      }
      const authorized = await api<PreparedTransfer>(
        `/api/wallet/arc/transfers/${prepared.transfer.id}/authorize`,
        { method: "POST" },
      );
      if (
        getAddress(authorized.call.to) !== getAddress(ARC_USDC_ADDRESS) ||
        authorized.call.value !== "0"
      ) {
        throw new Error(
          "The prepared USDC transfer is not valid for Arc Testnet.",
        );
      }
      const decoded = decodeFunctionData({
        abi: erc20Abi,
        data: authorized.call.data,
      });
      if (
        decoded.functionName !== "transfer" ||
        getAddress(decoded.args[0]) !==
          getAddress(prepared.transfer.recipientAddress) ||
        decoded.args[1] !== BigInt(prepared.transfer.amountBaseUnits)
      ) {
        throw new Error("The prepared transaction does not match this review.");
      }
      const userOperationHash = await wallet.submitUserOperation({
        to: authorized.call.to,
        data: authorized.call.data,
        value: 0n,
      });
      localStorage.setItem(
        `qastfund:arc-transfer:${prepared.transfer.id}`,
        userOperationHash,
      );
      setTransfer({
        ...prepared.transfer,
        status: "SUBMITTED",
        userOperationHash,
      });
      await resumeSubmitted(prepared.transfer.id, userOperationHash);
    } catch (cause) {
      const rejected = isUserRejection(cause);
      try {
        await api(`/api/wallet/arc/transfers/${prepared.transfer.id}/outcome`, {
          method: "POST",
          body: JSON.stringify({ outcome: rejected ? "REJECTED" : "UNKNOWN" }),
        });
      } catch {
        // Preserve the original signing/submission error.
      }
      setError(
        rejected
          ? "Passkey authorization was cancelled. No retry was submitted."
          : "The submission outcome is uncertain. Do not send again; use status refresh to reconcile it.",
      );
      await loadTransfer(prepared.transfer.id).catch(() => undefined);
    } finally {
      setIsBusy(false);
    }
  };

  if (transfer) {
    const terminal = ["CONFIRMED", "FAILED"].includes(transfer.status);
    return (
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Transfer status</CardTitle>
            <Badge tone={statusTone(transfer.status)}>
              {transfer.status.replaceAll("_", " ")}
            </Badge>
          </div>
          <CardDescription>
            {terminal
              ? "This status was verified against the persisted transfer record and Arc transaction data."
              : "The transfer is still being reconciled. Refreshing status never submits another transfer."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Amount</dt>
              <dd className="mt-1 font-semibold">{transfer.amount} USDC</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Network</dt>
              <dd className="mt-1 font-semibold">Arc Testnet</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Recipient</dt>
              <dd className="mt-1 font-mono text-sm break-all">
                {transfer.recipientAddress}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Submitted</dt>
              <dd className="mt-1 text-sm">
                {transfer.submittedAt
                  ? new Date(transfer.submittedAt).toLocaleString()
                  : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Circle user operation</dt>
              <dd className="mt-1 font-mono text-xs break-all">
                {transfer.userOperationHash ?? "Not available"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Arc transaction</dt>
              <dd className="mt-1 font-mono text-xs break-all">
                {transfer.transactionHash ?? "Pending"}
              </dd>
            </div>
          </dl>
          {error ? (
            <p className="text-sm text-rose-700" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {!terminal ? (
              <Button
                onClick={() => loadTransfer(transfer.id)}
                variant="secondary"
              >
                Refresh status
              </Button>
            ) : null}
            {transfer.explorerUrl ? (
              <a
                className="inline-flex h-11 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium"
                href={transfer.explorerUrl}
                rel="noreferrer"
                target="_blank"
              >
                View verified Arc transaction
              </a>
            ) : null}
            {terminal ? (
              <Button
                onClick={() => {
                  setTransfer(null);
                  setPrepared(null);
                  setRecipient("");
                  setAmount("");
                  window.history.replaceState(null, "", "/app/wallet/send");
                }}
                variant="outline"
              >
                Start another transfer
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (prepared) {
    return (
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>Review transfer</CardTitle>
          <CardDescription>
            Check every detail. Opening this review did not submit a
            transaction.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">From</dt>
              <dd className="mt-1 font-mono text-sm break-all">
                {prepared.transfer.senderAddress}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">To</dt>
              <dd className="mt-1 font-mono text-sm break-all">
                {prepared.transfer.recipientAddress}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Amount</dt>
              <dd className="mt-1 font-semibold">
                {prepared.transfer.amount} USDC
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Destination network</dt>
              <dd className="mt-1 font-semibold">Arc Testnet</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Network fee</dt>
              <dd className="mt-1 font-semibold">Sponsored · 0 USDC</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Total estimated cost</dt>
              <dd className="mt-1 font-semibold">
                {prepared.transfer.amount} USDC
              </dd>
            </div>
          </dl>
          {prepared.selfTransfer ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              The recipient is your own wallet. This transfer will not move
              funds to a different address.
            </p>
          ) : null}
          <div className="space-y-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            <p>Blockchain transactions are generally irreversible.</p>
            <p>Arc Testnet USDC has no real-world monetary value.</p>
          </div>
          {!wallet.isConnected ? (
            <p className="text-sm text-amber-700">
              Reconnect the enrolled passkey wallet before confirming.
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-rose-700" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {!wallet.isConnected ? (
              <Button
                isLoading={wallet.isLoading}
                onClick={wallet.reconnectWallet}
                variant="secondary"
              >
                Reconnect wallet
              </Button>
            ) : null}
            <Button
              disabled={!wallet.isConnected}
              isLoading={isBusy}
              onClick={confirm}
            >
              Confirm with passkey
            </Button>
            <Button
              disabled={isBusy}
              onClick={() => setPrepared(null)}
              variant="outline"
            >
              Edit details
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Transfer details</CardTitle>
          <Badge tone="info">Arc Testnet only</Badge>
        </div>
        <CardDescription>
          Only the official 6-decimal Arc Testnet USDC interface is supported.
          Gas is automatically sponsored on Circle testnet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-slate-500">Connected wallet</p>
              <p className="mt-1 font-mono text-sm">
                {wallet.walletAddress
                  ? shortAddress(wallet.walletAddress)
                  : "No active wallet"}
              </p>
            </div>
            {wallet.walletAddress ? (
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(wallet.walletAddress!);
                  setCopied(true);
                }}
                size="sm"
                variant="outline"
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            ) : null}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Available Arc Testnet USDC
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {wallet.onChainBalance ?? "—"} USDC
          </p>
        </div>
        <Field
          error={
            recipient ? (validation.recipientError ?? undefined) : undefined
          }
          htmlFor="recipient"
          label="Recipient wallet address"
        >
          <Input
            autoComplete="off"
            error={Boolean(recipient && validation.recipientError)}
            id="recipient"
            onChange={(event) => setRecipient(event.target.value.trim())}
            placeholder="0x…"
            spellCheck={false}
            value={recipient}
          />
        </Field>
        <Field htmlFor="amount" label="Amount">
          <div className="flex gap-2">
            <Input
              autoComplete="off"
              id="amount"
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              value={amount}
            />
            <Button
              disabled={!wallet.onChainBalance}
              onClick={() => setAmount(wallet.onChainBalance ?? "")}
              type="button"
              variant="outline"
            >
              Max
            </Button>
          </div>
          {amount && validation.amountError ? (
            <p className="text-sm text-rose-600">{validation.amountError}</p>
          ) : null}
        </Field>
        {error ? (
          <p className="text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          disabled={
            !wallet.walletAddress ||
            !recipient ||
            !amount ||
            Boolean(validation.recipientError || validation.amountError)
          }
          isLoading={isBusy}
          onClick={review}
        >
          Review transfer
        </Button>
      </CardContent>
    </Card>
  );
}
