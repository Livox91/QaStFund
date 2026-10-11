import { getAddress, type Address } from "viem";

import { USDC_BASE_UNITS_PER_CENT } from "@/shared/money/usdc";

export const MIN_PILOT_USDC_BALANCE = USDC_BASE_UNITS_PER_CENT;
export const MIN_PILOT_NATIVE_FEE_BALANCE = 1n;

export type PilotWalletRecord = Readonly<{
  userId: string;
  address: string | null;
  status: "PENDING" | "ACTIVE" | "FAILED";
  enrollmentState:
    | "NOT_STARTED"
    | "REGISTERING"
    | "REGISTERED"
    | "VERIFYING"
    | "ACTIVE"
    | "FAILED_RECOVERABLE";
}>;

export type PilotWalletOwnershipEvidence = Readonly<{
  organizationId: string;
  userId: string;
  address: string;
  consumedAt: Date | null;
}>;

export type PilotWalletCandidate = Readonly<{
  userId: string;
  address: Address;
}>;

export type PilotWalletBalance = PilotWalletCandidate &
  Readonly<{
    usdcBalance: bigint;
    nativeFeeBalance: bigint;
  }>;

function identityKey(input: { userId: string; address: string }): string {
  return [input.userId, input.address.toLowerCase()].join(":");
}

export function inspectPilotWalletRecords(
  wallets: readonly PilotWalletRecord[],
  ownershipEvidence: readonly PilotWalletOwnershipEvidence[],
) {
  const activeWallets = wallets
    .filter(
      (wallet): wallet is PilotWalletRecord & { address: string } =>
        wallet.status === "ACTIVE" &&
        wallet.enrollmentState === "ACTIVE" &&
        wallet.address !== null,
    )
    .map((wallet) => ({
      userId: wallet.userId,
      address: getAddress(wallet.address),
    }));
  const addressOwners = new Map<string, Set<string>>();
  for (const wallet of activeWallets) {
    const normalizedAddress = wallet.address.toLowerCase();
    const owners = addressOwners.get(normalizedAddress) ?? new Set<string>();
    owners.add(wallet.userId);
    addressOwners.set(normalizedAddress, owners);
  }
  const duplicateAddresses = [...addressOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([address]) => getAddress(address));
  const verifiedIdentities = new Set(
    ownershipEvidence
      .filter((evidence) => evidence.consumedAt !== null)
      .map(identityKey),
  );
  const verifiedWallets = activeWallets.filter((wallet) =>
    verifiedIdentities.has(identityKey(wallet)),
  );
  const unverifiedWallets = activeWallets.filter(
    (wallet) => !verifiedIdentities.has(identityKey(wallet)),
  );

  return {
    activeWallets,
    duplicateAddresses,
    verifiedWallets,
    unverifiedWallets,
  };
}

export function inspectPilotWalletBalances(
  balances: readonly PilotWalletBalance[],
) {
  const sufficientUsdc = balances.filter(
    (balance) => balance.usdcBalance >= MIN_PILOT_USDC_BALANCE,
  );
  const sufficientNativeFees = balances.filter(
    (balance) => balance.nativeFeeBalance >= MIN_PILOT_NATIVE_FEE_BALANCE,
  );
  const readyWallets = balances.filter(
    (balance) =>
      balance.usdcBalance >= MIN_PILOT_USDC_BALANCE &&
      balance.nativeFeeBalance >= MIN_PILOT_NATIVE_FEE_BALANCE,
  );

  return { sufficientUsdc, sufficientNativeFees, readyWallets };
}
