import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, toFunctionSelector, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

vi.mock("server-only", () => ({}));

import { employeeLendingEscrowAbi } from "@/integrations/arc/employee-lending-escrow";
import {
  borrowAuthorizationTypedData,
  borrowRequestIdToAuthorizationId,
} from "@/modules/loans/domain/borrow-authorization";
import {
  calculateOnChainRepaymentBaseUnits,
  friendlyBorrowTransactionError,
} from "@/modules/loans/domain/onchain-borrow";
import {
  confirmOnChainBorrow,
  prepareOnChainBorrow,
} from "@/modules/loans/application/onchain-borrow";
import {
  confirmOnChainBorrowSchema,
  prepareOnChainBorrowSchema,
} from "@/modules/loans/schemas/onchain-borrow.schema";

describe("on-chain borrowing values", () => {
  const actor = {
    userId: "10000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
  } as const;
  const offerId = "30000000-0000-4000-8000-000000000001";
  const requestId = "50000000-0000-4000-8000-000000000001";
  const contractAddress = "0x1111111111111111111111111111111111111111";

  it("encodes the numeric chain offer ID with the contract selector", () => {
    const authorizationId = `0x${"a".repeat(64)}` as const;
    const signature = `0x${"b".repeat(130)}` as const;
    const data = encodeFunctionData({
      abi: employeeLendingEscrowAbi,
      functionName: "acceptOffer",
      args: [17n, 2_000_000_000n, authorizationId, signature],
    });

    expect(data.slice(0, 10)).toBe(
      toFunctionSelector("acceptOffer(uint256,uint256,bytes32,bytes)"),
    );
  });

  it("binds an authorization to its wallet, offer, chain, and contract", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const contractAddress = "0x1111111111111111111111111111111111111111";
    const authorization = {
      offerId: 17n,
      borrower: "0x2222222222222222222222222222222222222222",
      expiry: 2_000_000_000n,
      authorizationId: borrowRequestIdToAuthorizationId(
        "50000000-0000-4000-8000-000000000001",
      ),
    } as const;
    const typedData = borrowAuthorizationTypedData(
      authorization,
      contractAddress,
    );
    const signature = await account.signTypedData(typedData);

    expect(
      await verifyTypedData({
        ...typedData,
        address: account.address,
        signature,
      }),
    ).toBe(true);
    for (const changed of [
      { ...authorization, offerId: 18n },
      {
        ...authorization,
        borrower: "0x3333333333333333333333333333333333333333" as const,
      },
    ]) {
      expect(
        await verifyTypedData({
          ...borrowAuthorizationTypedData(changed, contractAddress),
          address: account.address,
          signature,
        }),
      ).toBe(false);
    }
    expect(
      await verifyTypedData({
        ...borrowAuthorizationTypedData(
          authorization,
          "0x4444444444444444444444444444444444444444",
        ),
        address: account.address,
        signature,
      }),
    ).toBe(false);
  });

  it("keeps the signing secret out of the browser borrowing module", async () => {
    const source = await readFile(
      new URL(
        "../src/app/(employee)/app/borrow/[offerId]/confirm-borrow-form.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toContain("ARC_BORROW_AUTHORIZER_PRIVATE_KEY");
    expect(source).not.toContain("privateKeyToAccount");
  });

  it("does not issue authorization to an ineligible employee", async () => {
    const signAuthorization = vi.fn();
    const database = {
      loan: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (run: (transaction: unknown) => unknown) =>
        run({
          organizationMembership: {
            findUnique: vi.fn().mockResolvedValue({
              id: "40000000-0000-4000-8000-000000000001",
              isActive: true,
              employmentStatus: "ACTIVE",
              role: "EMPLOYEE",
              canBorrow: false,
              user: { name: "Ineligible Employee" },
            }),
          },
        }),
      ),
    };

    await expect(
      prepareOnChainBorrow(actor as never, offerId, requestId, {
        contractAddress,
        database: database as never,
        signAuthorization,
      }),
    ).rejects.toMatchObject({ code: "LENDING_OFFER_NOT_AVAILABLE" });
    expect(signAuthorization).not.toHaveBeenCalled();
  });

  it("does not issue authorization for a cross-organization offer", async () => {
    const signAuthorization = vi.fn();
    const database = {
      loan: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (run: (transaction: unknown) => unknown) =>
        run({
          organizationMembership: {
            findUnique: vi.fn().mockResolvedValue({
              id: "40000000-0000-4000-8000-000000000001",
              isActive: true,
              employmentStatus: "ACTIVE",
              role: "EMPLOYEE",
              canBorrow: true,
              user: { name: "Eligible Employee" },
            }),
          },
          arcWallet: {
            findUnique: vi.fn().mockResolvedValue({
              address: "0x2222222222222222222222222222222222222222",
              status: "ACTIVE",
              chainId: 5_042_002,
              organizationId: actor.organizationId,
            }),
          },
          lendingOffer: { findFirst: vi.fn().mockResolvedValue(null) },
        }),
      ),
    };

    await expect(
      prepareOnChainBorrow(actor as never, offerId, requestId, {
        contractAddress,
        database: database as never,
        signAuthorization,
      }),
    ).rejects.toMatchObject({ code: "LENDING_OFFER_NOT_AVAILABLE" });
    expect(signAuthorization).not.toHaveBeenCalled();
  });

  it("does not activate a database loan after a failed contract transaction", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      loan: {
        findFirst: vi.fn().mockResolvedValue({
          id: "60000000-0000-4000-8000-000000000001",
          status: "REQUESTED",
          lendingOfferId: offerId,
          chainLoanId: null,
          chainOfferId: "17",
          lenderWalletAddress: "0x3333333333333333333333333333333333333333",
          borrowerWalletAddress: "0x2222222222222222222222222222222222222222",
          principalBaseUnits: 100_000_000n,
          repaymentBaseUnits: 105_000_000n,
          feeRateBasisPoints: 500,
          durationDays: 30,
          acceptanceTransactionHash: null,
        }),
        updateMany,
      },
    };
    const getTransactionReceipt = vi.fn().mockResolvedValue({
      status: "reverted",
      logs: [],
    });

    await expect(
      confirmOnChainBorrow(
        actor as never,
        "60000000-0000-4000-8000-000000000001",
        `0x${"a".repeat(64)}`,
        {
          contractAddress,
          database: database as never,
          getTransactionReceipt: getTransactionReceipt as never,
          now: () => new Date("2026-10-03T12:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({ code: "LENDING_OFFER_NOT_AVAILABLE" });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
  });

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
    expect(
      friendlyBorrowTransactionError(
        new Error("execution reverted: AuthorizationExpired"),
      ),
    ).toContain("expired");
    expect(
      friendlyBorrowTransactionError(
        new Error("execution reverted: AuthorizationAlreadyUsed"),
      ),
    ).toContain("already been used");
    expect(
      friendlyBorrowTransactionError(
        new Error("execution reverted: InvalidAuthorization"),
      ),
    ).toContain("not authorized");
  });
});
