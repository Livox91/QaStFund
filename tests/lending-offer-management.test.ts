import { describe, expect, it, vi } from "vitest";

import {
  ForbiddenError,
  UnauthenticatedError,
} from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { toLendingOfferResponse } from "@/modules/lending/api/lending-offer-response";
import {
  LendingOfferNotFoundError,
  InvalidLendingOfferStatusTransitionError,
} from "@/modules/lending/application/errors/lending-offer-errors";
import {
  getLendingOffer,
  listActiveLendingOffers,
} from "@/modules/lending/application/get-lending-offer";
import type { LendingOfferRepository } from "@/modules/lending/application/ports/lending-offer-repository";
import { updateLendingOfferStatus } from "@/modules/lending/application/update-lending-offer-status";
import type {
  LendingOfferManagementStatus,
  LendingOfferStatus,
  LendingOfferView,
} from "@/modules/lending/domain/lending-offer";
import {
  createLendingOfferApiSchema,
  toCreateLendingOfferCommand,
} from "@/modules/lending/schemas/lending-offer-api.schema";

const now = new Date("2026-09-29T12:00:00.000Z");
const actor: AuthenticatedActor = {
  userId: "user-a",
  email: "alice@organization-a.test",
  name: "Alice",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYEE,
};

function offer(
  status: LendingOfferView["status"] = "ACTIVE",
): LendingOfferView {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    lender: { id: actor.userId, name: actor.name },
    amountMinorUnits: 50_000n,
    availableAmountMinorUnits: 50_000n,
    minimumLoanAmountMinorUnits: 1n,
    maximumLoanAmountMinorUnits: 10_000n,
    currency: "USD",
    durationDays: 30,
    feeRateBasisPoints: 300,
    expiresAt: new Date("2026-10-29T12:00:00.000Z"),
    createdAt: now,
    status,
  };
}

function repository(current = offer()): LendingOfferRepository {
  return {
    createForEmployee: vi.fn(async () => ({
      kind: "CREATED" as const,
      offer: current,
    })),
    listForEmployee: vi.fn(async () => ({
      currency: "USD",
      mockBalanceMinorUnits: 0n,
      committedBalanceMinorUnits: current.availableAmountMinorUnits,
      offers: [current],
    })),
    listMarketplace: vi.fn(async () => ({
      currency: "USD",
      offers: [current],
    })),
    listActiveForOrganization: vi.fn(async () => [current]),
    findForOrganization: vi.fn(async () => current),
    findForManagement: vi.fn(async () => ({
      kind: "FOUND" as const,
      offer: current,
    })),
    updateStatusIfCurrent: vi.fn(async ({ targetStatus }) => ({
      kind: "UPDATED" as const,
      offer: { ...current, status: targetStatus },
    })),
  };
}

describe("lending-offer API input", () => {
  it("parses exact decimal strings and initializes all capital as available", () => {
    const parsed = createLendingOfferApiSchema.parse({
      amount: "500.00",
      interestRate: "3.00",
      termDays: 30,
      maxAmountPerBorrower: "100.00",
    });
    const command = toCreateLendingOfferCommand(parsed, now);

    expect(command.amountMinorUnits).toBe(50_000n);
    expect(parsed.interestRate).toBe(300);
    expect(command.maximumLoanAmountMinorUnits).toBe(10_000n);
  });

  it.each(["1e3", "1.001", "-1", "NaN", 500])(
    "rejects malformed monetary amount %p",
    (amount) => {
      expect(
        createLendingOfferApiSchema.safeParse({
          amount,
          interestRate: "3.00",
          termDays: 30,
          maxAmountPerBorrower: "100.00",
        }).success,
      ).toBe(false);
    },
  );

  it("rejects a per-borrower maximum above the total amount", () => {
    expect(
      createLendingOfferApiSchema.safeParse({
        amount: "100.00",
        interestRate: "3.00",
        termDays: 30,
        maxAmountPerBorrower: "100.01",
      }).success,
    ).toBe(false);
  });

  it("serializes exact money strings and only safe lender fields", () => {
    expect(toLendingOfferResponse(offer())).toMatchObject({
      totalAmount: "500.00",
      availableAmount: "500.00",
      interestRate: "3.00",
      maxAmountPerBorrower: "100.00",
      lender: { id: "user-a", name: "Alice" },
    });
    expect(toLendingOfferResponse(offer())).not.toHaveProperty("passwordHash");
    expect(toLendingOfferResponse(offer()).lender).not.toHaveProperty("email");
  });
});

describe("organization-scoped offer reads", () => {
  it("derives active marketplace scope from the authenticated actor", async () => {
    const repo = repository();

    await expect(listActiveLendingOffers(actor, repo, now)).resolves.toEqual([
      offer(),
    ]);
    expect(repo.listActiveForOrganization).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      userId: actor.userId,
      now,
    });
  });

  it("returns not found when an organization-scoped lookup cannot see an offer", async () => {
    const repo = repository();
    vi.mocked(repo.findForOrganization).mockResolvedValue(null);

    await expect(
      getLendingOffer(actor, offer().id, repo, now),
    ).rejects.toBeInstanceOf(LendingOfferNotFoundError);
    expect(repo.findForOrganization).toHaveBeenCalledWith({
      organizationId: "organization-a",
      userId: "user-a",
      offerId: offer().id,
      now,
    });
  });

  it("rejects unauthenticated marketplace and detail requests", async () => {
    const repo = repository();

    await expect(
      listActiveLendingOffers(null, repo, now),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      getLendingOffer(null, offer().id, repo, now),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(repo.listActiveForOrganization).not.toHaveBeenCalled();
    expect(repo.findForOrganization).not.toHaveBeenCalled();
  });
});

describe("lending-offer ownership and status transitions", () => {
  it.each([
    ["ACTIVE", "PAUSED"],
    ["PAUSED", "ACTIVE"],
    ["ACTIVE", "CLOSED"],
    ["PAUSED", "CLOSED"],
  ] satisfies Array<[LendingOfferStatus, LendingOfferManagementStatus]>)(
    "allows an owner to change %s to %s",
    async (currentStatus, targetStatus) => {
      const repo = repository(offer(currentStatus));

      await expect(
        updateLendingOfferStatus(actor, offer().id, targetStatus, repo, now),
      ).resolves.toMatchObject({ status: targetStatus });
      expect(repo.updateStatusIfCurrent).toHaveBeenCalledWith({
        organizationId: actor.organizationId,
        userId: actor.userId,
        offerId: offer().id,
        expectedStatus: currentStatus,
        targetStatus,
        now,
      });
    },
  );

  it("does not allow a closed offer to be reopened", async () => {
    const repo = repository(offer("CLOSED"));

    await expect(
      updateLendingOfferStatus(actor, offer().id, "ACTIVE", repo, now),
    ).rejects.toBeInstanceOf(InvalidLendingOfferStatusTransitionError);
    expect(repo.updateStatusIfCurrent).not.toHaveBeenCalled();
  });

  it("does not reactivate an exhausted offer", async () => {
    const repo = repository({
      ...offer("PAUSED"),
      availableAmountMinorUnits: 0n,
    });

    await expect(
      updateLendingOfferStatus(actor, offer().id, "ACTIVE", repo, now),
    ).rejects.toBeInstanceOf(InvalidLendingOfferStatusTransitionError);
    expect(repo.updateStatusIfCurrent).not.toHaveBeenCalled();
  });

  it("does not allow another lender to modify the offer", async () => {
    const repo = repository();
    vi.mocked(repo.findForManagement).mockResolvedValue({ kind: "NOT_OWNER" });

    await expect(
      updateLendingOfferStatus(actor, offer().id, "PAUSED", repo, now),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.updateStatusIfCurrent).not.toHaveBeenCalled();
  });
});
