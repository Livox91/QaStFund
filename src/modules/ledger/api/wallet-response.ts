import type { Wallet, WalletTransaction } from "@/modules/ledger/domain/ledger";

export function formatMinorUnits(amount: bigint): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function toWalletTransactionResponse(transaction: WalletTransaction) {
  return {
    type: transaction.type,
    amount: formatMinorUnits(transaction.amountMinorUnits),
    direction: transaction.direction,
    status: transaction.status,
    reference: {
      type: transaction.referenceType,
      id: transaction.referenceId,
    },
    timestamp: transaction.timestamp.toISOString(),
  };
}

export function toWalletResponse(wallet: Wallet) {
  return {
    asset: wallet.asset,
    availableBalance: formatMinorUnits(wallet.availableBalanceMinorUnits),
  };
}
