export const WALLET_ASSET = "USDC" as const;

export type WalletTransactionDirection = "IN" | "OUT";

export type WalletTransaction = Readonly<{
  id: string;
  type: "DEPOSIT" | "LOAN_DISBURSEMENT" | "LOAN_REPAYMENT" | "WITHDRAWAL";
  amountMinorUnits: bigint;
  direction: WalletTransactionDirection;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  referenceType: "DEVELOPMENT_FUNDING" | "LOAN" | "REPAYMENT" | "WITHDRAWAL";
  referenceId: string;
  timestamp: Date;
}>;

export type Wallet = Readonly<{
  asset: typeof WALLET_ASSET;
  availableBalanceMinorUnits: bigint;
  transactions: ReadonlyArray<WalletTransaction>;
}>;
