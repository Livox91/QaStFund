import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { confirmFundedLendingOffer } from "@/modules/lending/application/funded-lending-offer";
import { confirmOnChainRepayment } from "@/modules/loans/application/onchain-repayment";

const contractAddress = "0x1111111111111111111111111111111111111111";
const lenderAddress = "0x2222222222222222222222222222222222222222";
const borrowerAddress = "0x3333333333333333333333333333333333333333";
const firstHash = `0x${"a".repeat(64)}` as const;
const secondHash = `0x${"b".repeat(64)}` as const;
const actor = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
};

describe("ambiguous on-chain transaction binding", () => {
  it("binds offer funding to the first submitted hash before receipt lookup", async () => {
    let boundHash: string | null = null;
    const getTransactionReceipt = vi
      .fn()
      .mockRejectedValue(new Error("pending"));
    const database = {
      lendingOffer: {
        findFirst: vi.fn(async () => ({
          id: "30000000-0000-4000-8000-000000000001",
          fundingStatus: "PENDING",
          fundingRequestId: "40000000-0000-4000-8000-000000000001",
          lenderWalletAddress: lenderAddress,
          principalBaseUnits: 1_000_000n,
          feeRateBasisPoints: 100,
          durationDays: 30,
          fundingTransactionHash: boundHash,
        })),
        updateMany: vi.fn(async ({ data }) => {
          boundHash = data.fundingTransactionHash;
          return { count: 1 };
        }),
        findUnique: vi.fn(),
      },
    };

    await expect(
      confirmFundedLendingOffer(
        actor as never,
        "30000000-0000-4000-8000-000000000001",
        firstHash,
        {
          contractAddress,
          database: database as never,
          getTransactionReceipt,
        },
      ),
    ).rejects.toMatchObject({ code: "FUNDING_CONFIRMATION_PENDING" });
    expect(boundHash).toBe(firstHash);

    await expect(
      confirmFundedLendingOffer(
        actor as never,
        "30000000-0000-4000-8000-000000000001",
        secondHash,
        {
          contractAddress,
          database: database as never,
          getTransactionReceipt,
        },
      ),
    ).rejects.toMatchObject({ code: "FUNDING_TRANSACTION_CONFLICT" });
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it("binds repayment to the first submitted hash before receipt lookup", async () => {
    let boundHash: string | null = null;
    const getTransactionReceipt = vi
      .fn()
      .mockRejectedValue(new Error("pending"));
    const database = {
      loanRepayment: {
        findFirst: vi.fn(async () => ({
          id: "50000000-0000-4000-8000-000000000001",
          status: "PENDING",
          paidAt: new Date("2026-10-12T00:00:00.000Z"),
          submissionTransactionHash: boundHash,
          loan: {
            id: "60000000-0000-4000-8000-000000000001",
            status: "ACTIVE",
            chainLoanId: "7",
            contractAddress,
            lenderWalletAddress: lenderAddress,
            borrowerWalletAddress: borrowerAddress,
            repaymentBaseUnits: 1_050_000n,
            repaymentTransactionHash: null,
            startedAt: new Date("2026-10-01T00:00:00.000Z"),
            borrowerMembershipId: "70000000-0000-4000-8000-000000000001",
            lenderMembershipId: "80000000-0000-4000-8000-000000000001",
            currency: "USD",
          },
        })),
        updateMany: vi.fn(async ({ data }) => {
          boundHash = data.submissionTransactionHash;
          return { count: 1 };
        }),
        findUnique: vi.fn(),
      },
    };

    await expect(
      confirmOnChainRepayment(
        actor as never,
        "60000000-0000-4000-8000-000000000001",
        "50000000-0000-4000-8000-000000000001",
        firstHash,
        {
          contractAddress,
          database: database as never,
          getTransactionReceipt,
        },
      ),
    ).rejects.toMatchObject({ code: "REPAYMENT_CONFIRMATION_PENDING" });
    expect(boundHash).toBe(firstHash);

    await expect(
      confirmOnChainRepayment(
        actor as never,
        "60000000-0000-4000-8000-000000000001",
        "50000000-0000-4000-8000-000000000001",
        secondHash,
        {
          contractAddress,
          database: database as never,
          getTransactionReceipt,
        },
      ),
    ).rejects.toMatchObject({ code: "REPAYMENT_TRANSACTION_CONFLICT" });
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
  });
});
