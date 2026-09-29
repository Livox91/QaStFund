import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { borrowFromOffer } from "@/modules/loans/application/borrow-from-offer";
import {
  BorrowAmountOutOfRangeError,
  InsufficientOfferLiquidityError,
  InsufficientLenderBalanceError,
  LendingOfferNotAvailableError,
} from "@/modules/loans/application/errors/borrow-loan-errors";
import { getBorrowableOffer } from "@/modules/loans/application/get-borrowable-offer";
import type { BorrowLoanRepository } from "@/modules/loans/application/ports/borrow-loan-repository";
import { quoteBorrowFromOffer } from "@/modules/loans/application/quote-borrow-from-offer";
import {
  calculateBorrowLoanSummary,
  isAmountWithinOfferTerms,
  type BorrowableOffer,
  type CreatedBorrowingLoan,
} from "@/modules/loans/domain/borrow-loan";
import {
  borrowOfferAmountSchema,
  confirmBorrowOfferSchema,
} from "@/modules/loans/schemas/borrow-from-offer.schema";

const now = new Date("2026-09-29T12:00:00.000Z");
const employee: AuthenticatedActor = {
  userId: "employee-a",
  email: "employee@organization-a.test",
  name: "Employee A",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYEE,
};
const offer: BorrowableOffer = {
  id: "10000000-0000-4000-8000-000000000001",
  availableAmountMinorUnits: 50_000n,
  minimumLoanAmountMinorUnits: 5_000n,
  maximumLoanAmountMinorUnits: 25_000n,
  currency: "USD",
  durationDays: 30,
  feeRateBasisPoints: 475,
  expiresAt: new Date("2026-10-31T23:59:59.999Z"),
};
const loan: CreatedBorrowingLoan = {
  id: "20000000-0000-4000-8000-000000000001",
  offerId: offer.id,
  principalAmountMinorUnits: 10_001n,
  feeAmountMinorUnits: 476n,
  totalRepaymentMinorUnits: 10_477n,
  currency: "USD",
  durationDays: 30,
  feeRateBasisPoints: 475,
  activatedAt: now,
  repaymentDueAt: new Date("2026-10-29T12:00:00.000Z"),
};
const command = {
  offerId: offer.id,
  amountMinorUnits: 10_001n,
  requestId: "50000000-0000-4000-8000-000000000001",
} as const;

function createRepository(): BorrowLoanRepository {
  return {
    findBorrowableOffer: vi.fn(async () => offer),
    createFromOffer: vi.fn(async () => ({ kind: "CREATED" as const, loan })),
  };
}

describe("borrowing validation and calculations", () => {
  it("parses money into integer minor units and validates request IDs", () => {
    expect(borrowOfferAmountSchema.parse({ amount: "100.01" })).toEqual({
      amount: 10_001n,
    });
    expect(
      confirmBorrowOfferSchema.safeParse({
        offerId: offer.id,
        amount: "100.001",
        requestId: command.requestId,
      }).success,
    ).toBe(false);
  });

  it("calculates a deterministic fee and repayment date", () => {
    expect(calculateBorrowLoanSummary(offer, 10_001n, now)).toEqual({
      principalAmountMinorUnits: 10_001n,
      feeAmountMinorUnits: 476n,
      totalRepaymentMinorUnits: 10_477n,
      repaymentDueAt: new Date("2026-10-29T12:00:00.000Z"),
    });
  });

  it("requires amounts to satisfy min, max, and current liquidity", () => {
    expect(isAmountWithinOfferTerms(offer, 4_999n)).toBe(false);
    expect(isAmountWithinOfferTerms(offer, 25_001n)).toBe(false);
    expect(
      isAmountWithinOfferTerms(
        { ...offer, availableAmountMinorUnits: 8_000n },
        10_000n,
      ),
    ).toBe(false);
    expect(isAmountWithinOfferTerms(offer, 10_000n)).toBe(true);
  });
});

describe("borrowing application boundary", () => {
  it("returns an authoritative quote without reserving capital", async () => {
    const repository = createRepository();

    await expect(
      quoteBorrowFromOffer(employee, offer.id, 10_001n, repository, now),
    ).resolves.toEqual({
      principalAmountMinorUnits: 10_001n,
      feeAmountMinorUnits: 476n,
      totalRepaymentMinorUnits: 10_477n,
      repaymentDueAt: new Date("2026-10-29T12:00:00.000Z"),
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 475,
    });
    expect(repository.findBorrowableOffer).toHaveBeenCalledOnce();
    expect(repository.createFromOffer).not.toHaveBeenCalled();
  });

  it("rejects quotes above the per-borrower maximum or current availability", async () => {
    const repository = createRepository();
    await expect(
      quoteBorrowFromOffer(employee, offer.id, 25_001n, repository, now),
    ).rejects.toBeInstanceOf(BorrowAmountOutOfRangeError);

    vi.mocked(repository.findBorrowableOffer).mockResolvedValue({
      ...offer,
      availableAmountMinorUnits: 8_000n,
    });
    await expect(
      quoteBorrowFromOffer(employee, offer.id, 10_000n, repository, now),
    ).rejects.toBeInstanceOf(InsufficientOfferLiquidityError);
  });

  it("does not quote own, cross-organization, paused, closed, or exhausted offers", async () => {
    const repository = createRepository();
    vi.mocked(repository.findBorrowableOffer).mockResolvedValue(null);

    await expect(
      quoteBorrowFromOffer(employee, offer.id, 10_000n, repository, now),
    ).rejects.toBeInstanceOf(LendingOfferNotAvailableError);
  });

  it("derives tenant and borrower scope only from the authenticated actor", async () => {
    const repository = createRepository();

    await expect(
      borrowFromOffer(employee, command, repository, now),
    ).resolves.toEqual(loan);
    expect(repository.createFromOffer).toHaveBeenCalledWith({
      organizationId: "organization-a",
      userId: "employee-a",
      command,
      now,
    });
  });

  it("uses the same tenant scope when loading the selected offer", async () => {
    const repository = createRepository();

    await getBorrowableOffer(employee, offer.id, repository, now);
    expect(repository.findBorrowableOffer).toHaveBeenCalledWith({
      organizationId: "organization-a",
      userId: "employee-a",
      offerId: offer.id,
      now,
    });
  });

  it("rejects non-employees before repository access", async () => {
    const repository = createRepository();
    const employer = { ...employee, role: ApplicationRole.EMPLOYER_ADMIN };

    await expect(
      borrowFromOffer(employer, command, repository, now),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.createFromOffer).not.toHaveBeenCalled();
  });

  it.each([
    ["OFFER_NOT_AVAILABLE", LendingOfferNotAvailableError],
    ["AMOUNT_OUT_OF_RANGE", BorrowAmountOutOfRangeError],
    ["INSUFFICIENT_LIQUIDITY", InsufficientOfferLiquidityError],
    ["INSUFFICIENT_LENDER_BALANCE", InsufficientLenderBalanceError],
  ] as const)(
    "maps %s to a safe application error",
    async (kind, ErrorType) => {
      const repository = createRepository();
      vi.mocked(repository.createFromOffer).mockResolvedValue({ kind });

      await expect(
        borrowFromOffer(employee, command, repository, now),
      ).rejects.toBeInstanceOf(ErrorType);
    },
  );

  it("returns the original loan for an idempotent retry", async () => {
    const repository = createRepository();
    vi.mocked(repository.createFromOffer).mockResolvedValue({
      kind: "ALREADY_CREATED",
      loan,
    });

    await expect(
      borrowFromOffer(employee, command, repository, now),
    ).resolves.toEqual(loan);
  });
});
