import { describe, expect, it } from "vitest";

import {
  calculateOnChainRepaymentBaseUnits,
  friendlyBorrowTransactionError,
} from "@/modules/loans/domain/onchain-borrow";
import {
  confirmOnChainBorrowSchema,
  prepareOnChainBorrowSchema,
} from "@/modules/loans/schemas/onchain-borrow.schema";

describe("on-chain borrowing values", () => {
  it("calculates 105 USDC for a 100 USDC offer at 500 basis points", () => {
    expect(calculateOnChainRepaymentBaseUnits(100_000_000n, 500)).toBe(
      105_000_000n,
    );
  });

  it("rounds positive fractional interest up to one base unit", () => {
    expect(calculateOnChainRepaymentBaseUnits(10_000n, 1)).toBe(10_001n);
  });

  it("validates idempotency IDs and transaction hashes", () => {
    expect(
      prepareOnChainBorrowSchema.safeParse({
        requestId: "50000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(
      confirmOnChainBorrowSchema.safeParse({
        transactionHash: `0x${"a".repeat(64)}`,
      }).success,
    ).toBe(true);
    expect(
      confirmOnChainBorrowSchema.safeParse({ transactionHash: "0x1234" })
        .success,
    ).toBe(false);
  });

  it("maps stale transaction failures to a safe marketplace message", () => {
    expect(
      friendlyBorrowTransactionError(new Error("execution reverted")),
    ).toBe("This offer is no longer available. Choose another lending offer.");
    expect(friendlyBorrowTransactionError(new Error("User rejected"))).toBe(
      "Wallet authorization was cancelled. No funds were received.",
    );
  });
});
