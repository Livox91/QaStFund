import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma";
import { LendingMarketplaceSort } from "@/modules/lending/domain/lending-offer";
import { prismaLendingOfferRepository } from "@/modules/lending/infrastructure/prisma-lending-offer-repository";
import { prismaBorrowLoanRepository } from "@/modules/loans/infrastructure/prisma-borrow-loan-repository";

const organizationA = randomUUID();
const organizationB = randomUUID();
const aliceId = randomUUID();
const bobId = randomUUID();
const charlieId = randomUUID();
const aliceMembershipId = randomUUID();
const bobMembershipId = randomUUID();
const charlieMembershipId = randomUUID();
const aliceOfferId = randomUUID();
const bobOfferId = randomUUID();
const charlieOfferId = randomUUID();
const unfundedOfferId = randomUUID();
const now = new Date("2026-09-29T12:00:00.000Z");

async function createUser(id: string, email: string, name: string) {
  await prisma.user.create({
    data: { id, email, name, passwordHash: "test-only" },
  });
}

async function createOffer(input: {
  id: string;
  organizationId: string;
  lenderMembershipId: string;
  fundingStatus: "FUNDED" | "PENDING";
}) {
  await prisma.lendingOffer.create({
    data: {
      ...input,
      amountMinorUnits: 10_000n,
      availableAmountMinorUnits: 10_000n,
      minimumLoanAmountMinorUnits: 10_000n,
      maximumLoanAmountMinorUnits: 10_000n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 500,
      expiresAt: new Date("2026-10-29T12:00:00.000Z"),
      status: "ACTIVE",
    },
  });
}

describe("funded offer organization isolation", () => {
  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        {
          id: organizationA,
          name: "Organization A",
          slug: `a-${organizationA}`,
        },
        {
          id: organizationB,
          name: "Organization B",
          slug: `b-${organizationB}`,
        },
      ],
    });
    await createUser(aliceId, `${aliceId}@test.local`, "Alice");
    await createUser(bobId, `${bobId}@test.local`, "Bob");
    await createUser(charlieId, `${charlieId}@test.local`, "Charlie");
    await prisma.organizationMembership.createMany({
      data: [
        {
          id: aliceMembershipId,
          organizationId: organizationA,
          userId: aliceId,
          role: "EMPLOYEE",
        },
        {
          id: bobMembershipId,
          organizationId: organizationA,
          userId: bobId,
          role: "EMPLOYEE",
        },
        {
          id: charlieMembershipId,
          organizationId: organizationB,
          userId: charlieId,
          role: "EMPLOYEE",
        },
      ],
    });
    await createOffer({
      id: aliceOfferId,
      organizationId: organizationA,
      lenderMembershipId: aliceMembershipId,
      fundingStatus: "FUNDED",
    });
    await createOffer({
      id: bobOfferId,
      organizationId: organizationA,
      lenderMembershipId: bobMembershipId,
      fundingStatus: "FUNDED",
    });
    await createOffer({
      id: charlieOfferId,
      organizationId: organizationB,
      lenderMembershipId: charlieMembershipId,
      fundingStatus: "FUNDED",
    });
    await createOffer({
      id: unfundedOfferId,
      organizationId: organizationA,
      lenderMembershipId: aliceMembershipId,
      fundingStatus: "PENDING",
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationA, organizationB] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [aliceId, bobId, charlieId] } },
    });
    await prisma.$disconnect();
  });

  it("shows Bob only Alice's funded offer from their organization", async () => {
    const marketplace = await prismaLendingOfferRepository.listMarketplace({
      organizationId: organizationA,
      userId: bobId,
      now,
      filters: { sort: LendingMarketplaceSort.LOWEST_FEE },
    });
    expect(marketplace?.offers.map(({ id }) => id)).toEqual([aliceOfferId]);
  });

  it("enforces the same scope when Bob opens an offer", async () => {
    await expect(
      prismaBorrowLoanRepository.findBorrowableOffer({
        organizationId: organizationA,
        userId: bobId,
        offerId: aliceOfferId,
        now,
      }),
    ).resolves.toMatchObject({ id: aliceOfferId, lenderName: "Alice" });

    for (const offerId of [bobOfferId, charlieOfferId, unfundedOfferId]) {
      await expect(
        prismaBorrowLoanRepository.findBorrowableOffer({
          organizationId: organizationA,
          userId: bobId,
          offerId,
          now,
        }),
      ).resolves.toBeNull();
    }
  });
});
