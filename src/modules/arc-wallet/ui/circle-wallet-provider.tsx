"use client";

import {
  WebAuthnMode,
  type WebAuthnCredential,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
} from "@circle-fin/modular-wallets-core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createPublicClient, type Address, type Hex } from "viem";
import {
  createBundlerClient,
  toWebAuthnAccount,
  type SmartAccount,
} from "viem/account-abstraction";

import {
  arcTestnet,
  getArcModularClientUrl,
} from "@/integrations/arc/arc-testnet";

type ArcWalletView = Readonly<{
  status: "NOT_CONFIGURED" | "PENDING" | "ACTIVE" | "FAILED";
  address: `0x${string}` | null;
  network: "ARC_TESTNET";
  chainId: 5_042_002;
  walletType: "CIRCLE_MODULAR";
  enrollmentState:
    | "NOT_STARTED"
    | "REGISTERING"
    | "REGISTERED"
    | "VERIFYING"
    | "ACTIVE"
    | "FAILED_RECOVERABLE";
  onChainBalance: string | null;
  asset: "USDC";
}>;

type WalletApiResponse = Readonly<{ arc: ArcWalletView }>;

type CircleWalletContextValue = Readonly<{
  walletAddress: `0x${string}` | null;
  walletStatus: ArcWalletView["status"];
  onChainBalance: string | null;
  isConnected: boolean;
  isPasskeyReady: boolean;
  isLoading: boolean;
  error: string | null;
  setupWallet: () => Promise<void>;
  recoverWallet: () => Promise<void>;
  reconnectWallet: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  signMessage: (message: string) => Promise<Hex>;
  sendUserOperation: (
    calls: ReadonlyArray<{ to: Address; data: Hex; value?: bigint }>,
  ) => Promise<Hex>;
}>;

const CircleWalletContext = createContext<CircleWalletContextValue | null>(
  null,
);

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return (
    body?.error?.message ?? `Request failed with status ${response.status}`
  );
}

async function fetchArcWallet(): Promise<ArcWalletView> {
  const response = await fetch("/api/wallet", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const body = (await response.json()) as WalletApiResponse;
  return body.arc;
}

export function isDuplicateCircleUsernameError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const message = cause.message.toLowerCase();
  return (
    cause.name === "InvalidStateError" ||
    message.includes("username is duplicated") ||
    message.includes("credential already registered")
  );
}

export function CircleWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [wallet, setWallet] = useState<ArcWalletView | null>(null);
  const [smartAccount, setSmartAccount] = useState<SmartAccount | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isPasskeyReady = useSyncExternalStore(
    () => () => undefined,
    () => window.isSecureContext && "PublicKeyCredential" in window,
    () => false,
  );

  const refreshWallet = useCallback(async () => {
    setWallet(await fetchArcWallet());
  }, []);

  useEffect(() => {
    let ignore = false;
    void fetchArcWallet()
      .then((arcWallet) => {
        if (!ignore) setWallet(arcWallet);
      })
      .catch((cause: unknown) => {
        if (!ignore)
          setError(
            cause instanceof Error ? cause.message : "Wallet load failed",
          );
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const connect = useCallback(
    async (intent: "CREATE" | "RECOVER") => {
      const clientKey = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
      const clientUrl = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL;
      if (!clientKey || !clientUrl) {
        throw new Error("Circle Modular Wallet configuration is missing.");
      }
      if (!window.isSecureContext || !("PublicKeyCredential" in window)) {
        throw new Error(
          "Passkeys require a secure HTTPS origin or localhost in a supported browser.",
        );
      }
      const passkeyTransport = toPasskeyTransport(clientUrl, clientKey);
      const begin = async (requestedIntent: "CREATE" | "RECOVER") => {
        const response = await fetch("/api/wallet/arc/enrollment", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: requestedIntent }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        return (await response.json()) as {
          action: "REGISTER" | "LOGIN";
          username: string | null;
        };
      };
      let plan = await begin(intent);
      let credential: WebAuthnCredential;
      try {
        credential = await toWebAuthnCredential({
          transport: passkeyTransport,
          mode:
            plan.action === "REGISTER"
              ? WebAuthnMode.Register
              : WebAuthnMode.Login,
          ...(plan.action === "REGISTER" && plan.username
            ? { username: plan.username }
            : {}),
        });
      } catch (cause) {
        if (
          plan.action !== "REGISTER" ||
          !isDuplicateCircleUsernameError(cause)
        ) {
          throw cause;
        }
        plan = await begin("RECOVER");
        credential = await toWebAuthnCredential({
          transport: passkeyTransport,
          mode: WebAuthnMode.Login,
        });
      }
      if (plan.action === "REGISTER") {
        const registeredResponse = await fetch(
          "/api/wallet/arc/enrollment/registered",
          { method: "POST", credentials: "include" },
        );
        if (!registeredResponse.ok)
          throw new Error(await readApiError(registeredResponse));
      }
      const modularTransport = toModularTransport(
        getArcModularClientUrl(clientUrl),
        clientKey,
      );
      const publicClient = createPublicClient({
        chain: arcTestnet,
        transport: modularTransport,
      });
      const account = await toCircleSmartAccount({
        client: publicClient,
        owner: toWebAuthnAccount({ credential }),
      });
      const address = account.address;
      const challengeResponse = await fetch("/api/wallet/arc/challenge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!challengeResponse.ok)
        throw new Error(await readApiError(challengeResponse));
      const challenge = (await challengeResponse.json()) as {
        challengeId: string;
        address: `0x${string}`;
        nonce: string;
        message: string;
      };
      const signature = await account.signMessage({
        message: challenge.message,
      });
      const completionResponse = await fetch("/api/wallet/arc/complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          address: challenge.address,
          nonce: challenge.nonce,
          signature,
        }),
      });
      if (!completionResponse.ok)
        throw new Error(await readApiError(completionResponse));
      setSmartAccount(account);
      setIsConnected(true);
      await refreshWallet();
    },
    [refreshWallet],
  );

  const runConnection = useCallback(
    async (intent: "CREATE" | "RECOVER") => {
      setIsLoading(true);
      setError(null);
      try {
        await connect(intent);
      } catch (cause) {
        setIsConnected(false);
        setError(
          cause instanceof Error ? cause.message : "Passkey operation failed.",
        );
        throw cause;
      } finally {
        setIsLoading(false);
      }
    },
    [connect],
  );

  const value = useMemo<CircleWalletContextValue>(
    () => ({
      walletAddress: wallet?.address ?? null,
      walletStatus: wallet?.status ?? "NOT_CONFIGURED",
      onChainBalance: wallet?.onChainBalance ?? null,
      isConnected,
      isPasskeyReady,
      isLoading,
      error,
      setupWallet: () => runConnection("CREATE"),
      recoverWallet: () => runConnection("RECOVER"),
      reconnectWallet: () => runConnection("RECOVER"),
      refreshWallet,
      async signMessage(message) {
        if (!smartAccount) throw new Error("Reconnect the Arc wallet first.");
        return smartAccount.signMessage({ message });
      },
      async sendUserOperation(calls) {
        if (!smartAccount) throw new Error("Reconnect the Arc wallet first.");
        const clientKey = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
        const clientUrl = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL;
        if (!clientKey || !clientUrl) {
          throw new Error("Circle Modular Wallet configuration is missing.");
        }
        const transport = toModularTransport(
          getArcModularClientUrl(clientUrl),
          clientKey,
        );
        const publicClient = createPublicClient({
          chain: arcTestnet,
          transport,
        });
        const bundlerClient = createBundlerClient({
          account: smartAccount,
          chain: arcTestnet,
          client: publicClient,
          transport,
          paymaster: true,
        });
        const userOperationHash = await bundlerClient.sendUserOperation({
          calls: [...calls],
        });
        const result = await bundlerClient.waitForUserOperationReceipt({
          hash: userOperationHash,
        });
        return result.receipt.transactionHash;
      },
    }),
    [
      error,
      isConnected,
      isLoading,
      isPasskeyReady,
      refreshWallet,
      runConnection,
      smartAccount,
      wallet,
    ],
  );

  return (
    <CircleWalletContext.Provider value={value}>
      {children}
    </CircleWalletContext.Provider>
  );
}

export function useCircleWallet(): CircleWalletContextValue {
  const context = useContext(CircleWalletContext);
  if (!context) {
    throw new Error("useCircleWallet must be used within CircleWalletProvider");
  }
  return context;
}
