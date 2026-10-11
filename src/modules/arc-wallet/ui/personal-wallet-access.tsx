"use client";

import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
} from "@circle-fin/modular-wallets-core";
import { useState, useSyncExternalStore } from "react";
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
  type Address,
} from "viem";
import { toWebAuthnAccount } from "viem/account-abstraction";

import {
  ARC_NATIVE_USDC_DECIMALS,
  ARC_USDC_ADDRESS,
  ARC_USDC_DECIMALS,
  arcTestnet,
  getArcModularClientUrl,
} from "@/integrations/arc/arc-testnet";
import { Button, buttonStyles } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";

type WalletSnapshot = Readonly<{
  address: Address;
  usdcBalance: string;
  nativeFeeBalance: string;
}>;

export function PersonalWalletAccess() {
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPasskeyReady = useSyncExternalStore(
    () => () => undefined,
    () => window.isSecureContext && "PublicKeyCredential" in window,
    () => false,
  );

  const reconnect = async () => {
    setIsLoading(true);
    setError(null);
    setCopied(false);
    try {
      const clientKey = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
      const clientUrl = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL;
      if (!clientKey || !clientUrl) {
        throw new Error("Circle Modular Wallet configuration is missing.");
      }
      const credential = await toWebAuthnCredential({
        transport: toPasskeyTransport(clientUrl, clientKey),
        mode: WebAuthnMode.Login,
      });
      const modularTransport = toModularTransport(
        getArcModularClientUrl(clientUrl),
        clientKey,
      );
      const modularClient = createPublicClient({
        chain: arcTestnet,
        transport: modularTransport,
      });
      const account = await toCircleSmartAccount({
        client: modularClient,
        owner: toWebAuthnAccount({ credential }),
      });
      const rpcClient = createPublicClient({
        chain: arcTestnet,
        transport: http(),
      });
      const [usdcBalance, nativeFeeBalance] = await Promise.all([
        rpcClient.readContract({
          address: ARC_USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        }),
        rpcClient.getBalance({ address: account.address }),
      ]);
      setWallet({
        address: account.address,
        usdcBalance: formatUnits(usdcBalance, ARC_USDC_DECIMALS),
        nativeFeeBalance: formatUnits(
          nativeFeeBalance,
          ARC_NATIVE_USDC_DECIMALS,
        ),
      });
    } catch (cause) {
      setWallet(null);
      setError(
        cause instanceof Error ? cause.message : "Unable to reconnect wallet.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl shadow-xl shadow-slate-200/60">
      <CardHeader>
        <CardTitle>Access your personal Arc wallet</CardTitle>
        <CardDescription>
          Reconnect the existing passkey to view your full address and Arc
          Testnet balances. An active organization membership is not required,
          and this page does not submit transactions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          disabled={!isPasskeyReady}
          isLoading={isLoading}
          onClick={reconnect}
          variant="secondary"
        >
          Reconnect existing wallet
        </Button>

        {!isPasskeyReady ? (
          <p className="mt-4 text-sm text-amber-700">
            Passkeys require localhost or a secure HTTPS connection in a
            supported browser.
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}

        {wallet ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Wallet address
            </p>
            <p className="mt-2 font-mono text-sm break-all text-slate-950">
              {wallet.address}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(wallet.address);
                  setCopied(true);
                }}
                size="sm"
                variant="outline"
              >
                {copied ? "Copied" : "Copy address"}
              </Button>
              <a
                className={buttonStyles({ size: "sm", variant: "outline" })}
                href={`${arcTestnet.blockExplorers.default.url}/address/${wallet.address}`}
                rel="noreferrer"
                target="_blank"
              >
                View on Arc Explorer
              </a>
            </div>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">ERC-20 USDC</dt>
                <dd className="mt-1 text-sm font-medium text-slate-950">
                  {wallet.usdcBalance} USDC
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Native fee balance</dt>
                <dd className="mt-1 text-sm font-medium text-slate-950">
                  {wallet.nativeFeeBalance} USDC
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
