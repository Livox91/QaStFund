import type { Address } from "viem";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  ARC_WALLET_TYPE,
} from "@/integrations/arc/arc-testnet";

export type ArcWalletStatus = "PENDING" | "ACTIVE" | "FAILED";
export type ArcWalletEnrollmentState =
  | "NOT_STARTED"
  | "REGISTERING"
  | "REGISTERED"
  | "VERIFYING"
  | "ACTIVE"
  | "FAILED_RECOVERABLE";

export type ArcWallet = Readonly<{
  id: string;
  organizationId: string;
  userId: string;
  address: Address | null;
  network: typeof ARC_TESTNET_NETWORK;
  chainId: typeof ARC_TESTNET_CHAIN_ID;
  walletType: typeof ARC_WALLET_TYPE;
  status: ArcWalletStatus;
  enrollmentState: ArcWalletEnrollmentState;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ArcWalletChallenge = Readonly<{
  id: string;
  organizationId: string;
  userId: string;
  address: Address;
  nonceHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}>;
