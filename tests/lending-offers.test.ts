import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { createLendingOffer } from "@/modules/lending/application/create-lending-offer";
import { InsufficientMockBalanceError } from "@/modules/lending/application/errors/lending-offer-errors";
import { getEmployeeLending } from "@/modules/lending/application/get-employee-lending";
import { getLendingMarketplace } from "@/modules/lending/application/get-lending-marketplace";
import type { LendingOfferRepository } from "@/modules/lending/application/ports/lending-offer-repository";
import {
  calculateEstimatedRepayment,
  calculateAvailableMockBalance,
  getLendingOfferDisplayStatus,
  LendingMarketplaceSort,
  type CreateLendingOfferCommand,
  type LendingOfferView,
} from "@/modules/lending/domain/lending-offer";
import { createLendingOfferSchema } from "@/modules/lending/schemas/create-lending-offer.schema";
import { lendingMarketplaceQuerySchema } from "@/modules/lending/schemas/lending-marketplace.schema";

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
const command: CreateLendingOfferCommand = {
  amountMinorUnits: 50_000n,
  minimumLoanAmountMinorUnits: 5_000n,
  maximumLoanAmountMinorUnits: 25_000n,
  durationDays: 30,
  feeRateBasisPoints: 475,
  expiresAt: new Date("2026-10-31T23:59:59.999Z"),
};
const offer: LendingOfferView = {
  id: "offer-a",
  ...command,
  availableAmountMinorUnits: command.amountMinorUnits,
  currency: "USD",
  createdAt: now,
  status: "ACTIVE",
};
const marketplaceFilters = {
  amountMinorUnits: 20_000n,
  maximumDurationDays: 30,
  sort: LendingMarketplaceSort.LOWEST_FEE,
} as const;

function createRepository(): LendingOfferRepository {
  return {
    createForEmployee: vi.fn(async () => ({
      kind: "CREATED" as const,
      offer,
    })),
    listForEmployee: vi.fn(async () => ({
      currency: "USD",
      mockBalanceMinorUnits: 100_000n,
      committedBalanceMinorUnits: 50_000n,
      offers: [offer],
    })),
    listMarketplace: vi.fn(async () => ({
      currency: "USD",
      offers: [offer],
    })),
  };
}

describe("create lending offer validation", () => {
  it("parses money and percentage fields without floating-point arithmetic", () => {
    expect(
      createLendingOfferSchema(now).parse({
        amountAvailable: "500.25",
        minimumLoanAmount: "50",
        maximumLoanAmount: "250.10",
        durationDays: "30",
        feeRatePercent: "4.75",
        expirationDate: "2026-10-31",
      }),
    ).toEqual({
      amountMinorUnits: 50_025n,
      minimumLoanAmountMinorUnits: 5_000n,
      maximumLoanAmountMinorUnits: 25_010n,
      durationDays: 30,
      feeRateBasisPoints: 475,
      expiresAt: new Date("2026-10-31T23:59:59.999Z"),
    });
  });

  it("rejects invalid ranges, rates, durations, and expiration dates", () => {
    const result = createLendingOfferSchema(now).safeParse({
      amountAvailable: "100",
      minimumLoanAmount: "90",
      maximumLoanAmount: "120",
      durationDays: "0",
      feeRatePercent: "100.01",
      expirationDate: "2026-09-28",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toMatchObject({
        maximumLoanAmount: expect.any(Array),
        durationDays: expect.any(Array),
        feeRatePercent: expect.any(Array),
        expirationDate: expect.any(Array),
      });
    }
  });

  it("validates marketplace filters and safely defaults invalid sorting", () => {
    expect(
      lendingMarketplaceQuerySchema.parse({
        amountMinorUnits: "250.50",
        maximumDurationDays: "30",
        sort: "unknown",
      }),
    ).toEqual({
      amountMinorUnits: 25_050n,
      maximumDurationDays: 30,
      sort: LendingMarketplaceSort.LOWEST_FEE,
    });
  });
});

describe("lending offer application services", () => {
  it("derives creation scope exclusively from the authenticated employee", async () => {
    const repository = createRepository();

    await expect(
      createLendingOffer(employee, command, repository, now),
    ).resolves.toEqual(offer);
    expect(repository.createForEmployee).toHaveBeenCalledWith({
      organizationId: "organization-a",
      userId: "employee-a",
      command,
      now,
    });
  });

  it("returns a safe insufficient-balance error", async () => {
    const repository = createRepository();
    vi.mocked(repository.createForEmployee).mockResolvedValue({
      kind: "INSUFFICIENT_BALANCE",
      availableBalanceMinorUnits: 10_000n,
    });

    await expect(
      createLendingOffer(employee, command, repository, now),
    ).rejects.toBeInstanceOf(InsufficientMockBalanceError);
  });

  it("scopes My Lending and marketplace reads to the actor", async () => {
    const repository = createRepository();

    await expect(
      getEmployeeLending(employee, repository, now),
    ).resolves.toMatchObject({ availableBalanceMinorUnits: 50_000n });
    await expect(
      getLendingMarketplace(employee, marketplaceFilters, repository, now),
    ).resolves.toMatchObject({ currency: "USD" });

    const scope = {
      organizationId: "organization-a",
      userId: "employee-a",
      now,
    };
    expect(repository.listForEmployee).toHaveBeenCalledWith(scope);
    expect(repository.listMarketplace).toHaveBeenCalledWith({
      ...scope,
      filters: marketplaceFilters,
    });
  });

  it("rejects employer admins before accessing lending data", async () => {
    const repository = createRepository();
    const employer = { ...employee, role: ApplicationRole.EMPLOYER_ADMIN };

    await expect(
      createLendingOffer(employer, command, repository, now),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getEmployeeLending(employer, repository, now),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.createForEmployee).not.toHaveBeenCalled();
    expect(repository.listForEmployee).not.toHaveBeenCalled();
  });
});

describe("lending offer domain projections", () => {
  it("releases expired commitments from calculated availability", () => {
    expect(calculateAvailableMockBalance(100_000n, 40_000n)).toBe(60_000n);
    expect(calculateAvailableMockBalance(100_000n, 120_000n)).toBe(0n);
    expect(
      getLendingOfferDisplayStatus(
        "ACTIVE",
        new Date("2026-09-29T11:59:59.000Z"),
        now,
      ),
    ).toBe("EXPIRED");
  });

  it("calculates estimated repayment with deterministic upward rounding", () => {
    expect(calculateEstimatedRepayment(10_001n, 475)).toBe(10_477n);
  });
});
