"use client";

import { useState } from "react";

import { useCircleWallet } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import type { Employee } from "@/modules/employees/domain/employee";
import { arcTestnet } from "@/integrations/arc/arc-testnet";
import { Button, buttonStyles } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { StatusDisplay } from "@/shared/ui/status-display";

function formatUsdcBalance(balance: string | null): string {
  if (balance === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(balance));
}

function walletStatusLabel(
  status: "NOT_CONFIGURED" | "PENDING" | "ACTIVE" | "FAILED",
): string {
  if (status === "ACTIVE") return "Ready";
  if (status === "PENDING") return "Creating";
  if (status === "FAILED") return "Needs attention";
  return "Not created";
}

function persistedWalletStatus(
  status: Employee["walletStatus"],
): "NOT_CONFIGURED" | "PENDING" | "ACTIVE" | "FAILED" {
  if (status === "ready") return "ACTIVE";
  if (status === "creating") return "PENDING";
  if (status === "error") return "FAILED";
  return "NOT_CONFIGURED";
}

export function ArcWalletPanel({ employee }: { employee: Employee }) {
  const wallet = useCircleWallet();
  const [actionError, setActionError] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const walletAddress = wallet.walletAddress ?? employee.walletAddress ?? null;
  const walletStatus =
    wallet.isLoading && wallet.walletStatus === "NOT_CONFIGURED"
      ? persistedWalletStatus(employee.walletStatus)
      : wallet.walletStatus;

  const run = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Passkey operation failed.",
      );
    }
  };

  return (
    <Card className="mt-8" aria-label="Your account">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Your Account</CardTitle>
          <CardDescription>
            Your personal wallet is linked to {employee.email}, secured with
            your device passkey, and can be reconnected after an organization
            change.
          </CardDescription>
        </div>
        <StatusDisplay status={employee.employmentStatus} />
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-start justify-between gap-4">
          {walletStatus === "NOT_CONFIGURED" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!wallet.isPasskeyReady}
                isLoading={wallet.isLoading}
                onClick={() => run(wallet.setupWallet)}
                variant="secondary"
              >
                Set up wallet
              </Button>
              <Button
                disabled={!wallet.isPasskeyReady}
                isLoading={wallet.isLoading}
                onClick={() => run(wallet.recoverWallet)}
                variant="outline"
              >
                Reconnect existing wallet
              </Button>
            </div>
          ) : walletStatus === "PENDING" ? (
            <Button
              disabled={!wallet.isPasskeyReady}
              isLoading={wallet.isLoading}
              onClick={() => run(wallet.recoverWallet)}
              variant="secondary"
            >
              Continue setup
            </Button>
          ) : walletStatus === "FAILED" ? (
            <Button
              disabled={!wallet.isPasskeyReady}
              isLoading={wallet.isLoading}
              onClick={() => run(wallet.recoverWallet)}
              variant="secondary"
            >
              Reconnect existing wallet
            </Button>
          ) : walletStatus === "ACTIVE" && !wallet.isConnected ? (
            <Button
              disabled={!wallet.isPasskeyReady}
              isLoading={wallet.isLoading}
              onClick={() => run(wallet.reconnectWallet)}
              variant="outline"
            >
              Reconnect wallet
            </Button>
          ) : null}
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <dt className="text-xs text-slate-500">Wallet</dt>
            <dd className="mt-1 font-mono text-sm font-medium break-all text-slate-950">
              {walletAddress ?? "Not set up"}
            </dd>
            {walletAddress ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={async () => {
                    await navigator.clipboard.writeText(walletAddress);
                    setAddressCopied(true);
                  }}
                  size="sm"
                  variant="outline"
                >
                  {addressCopied ? "Copied" : "Copy address"}
                </Button>
                <a
                  className={buttonStyles({ size: "sm", variant: "outline" })}
                  href={`${arcTestnet.blockExplorers.default.url}/address/${walletAddress}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  View on Arc Explorer
                </a>
              </div>
            ) : null}
          </div>
          <div>
            <dt className="text-xs text-slate-500">USDC Balance</dt>
            <dd className="mt-1 text-sm font-medium text-slate-950">
              {formatUsdcBalance(wallet.onChainBalance)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Status</dt>
            <dd className="mt-1 text-sm font-medium text-slate-950">
              {walletStatusLabel(walletStatus)}
            </dd>
          </div>
        </dl>

        {!wallet.isPasskeyReady ? (
          <p className="mt-4 text-sm text-amber-700">
            Wallet access requires localhost or a secure connection in a
            supported browser.
          </p>
        ) : null}
        {(actionError ?? wallet.error) ? (
          <p className="mt-4 text-sm text-rose-700" role="alert">
            {actionError ?? wallet.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
