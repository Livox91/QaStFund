import { describe, expect, it } from "vitest";

import {
  formatMinorUnits,
  toWalletResponse,
  toWalletTransactionResponse,
} from "@/modules/ledger/api/wallet-response";
import { fundWalletSchema } from "@/modules/ledger/schemas/fund-wallet.schema";

describe("internal wallet API values", () => {
  it("parses USDC values without floating-point arithmetic", () => {
    expect(fundWalletSchema.parse({ amount: "500.01" }).amount).toBe(50_001n);
    expect(() => fundWalletSchema.parse({ amount: "1.001" })).toThrow();
  });

  it("returns authoritative balances as decimal strings", () => {
    expect(
      toWalletResponse({
        asset: "USDC",
        availableBalanceMinorUnits: 45_000n,
        transactions: [],
      }),
    ).toEqual({ asset: "USDC", availableBalance: "450.00" });
    expect(formatMinorUnits(-151n)).toBe("-1.51");
  });

  it("hides ledger account details from transaction history", () => {
    expect(
      toWalletTransactionResponse({
        id: "transaction-id",
        type: "LOAN_REPAYMENT",
        amountMinorUnits: 2_000n,
        direction: "IN",
        status: "COMPLETED",
        referenceType: "REPAYMENT",
        referenceId: "repayment-id",
        timestamp: new Date("2026-09-29T12:00:00.000Z"),
      }),
    ).toEqual({
      type: "LOAN_REPAYMENT",
      amount: "20.00",
      direction: "IN",
      status: "COMPLETED",
      reference: { type: "REPAYMENT", id: "repayment-id" },
      timestamp: "2026-09-29T12:00:00.000Z",
    });
  });
});
