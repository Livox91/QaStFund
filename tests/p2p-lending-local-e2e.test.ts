import { randomUUID } from "node:crypto";

import { network } from "hardhat";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma";
import { beginArcWalletEnrollment } from "@/modules/arc-wallet/application/arc-wallet-identity";
import {
  completeArcWalletChallenge,
  issueArcWalletChallenge,
} from "@/modules/arc-wallet/application/arc-wallet-enrollment";
import { prismaArcWalletRepository } from "@/modules/arc-wallet/infrastructure/prisma-arc-wallet-repository";
import { registerOrganizationAdmin } from "@/modules/auth/application/register-organization-admin";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { prismaRegistrationRepository } from "@/modules/auth/infrastructure/prisma-registration-repository";
import {
  confirmFundedLendingOffer,
  prepareFundedLendingOffer,
} from "@/modules/lending/application/funded-lending-offer";
import { LendingMarketplaceSort } from "@/modules/lending/domain/lending-offer";
import { prismaLendingOfferRepository } from "@/modules/lending/infrastructure/prisma-lending-offer-repository";
import {
  confirmOnChainBorrow,
  prepareOnChainBorrow,
} from "@/modules/loans/application/onchain-borrow";
import {
  confirmOnChainRepayment,
  prepareOnChainRepayment,
} from "@/modules/loans/application/onchain-repayment";

const suffix = randomUUID();
const organizationIds: string[] = [];
const userIds: string[] = [];

describe("local P2P lending lifecycle", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("keeps employer, employee wallets, escrow transfers, and database state consistent", async () => {
    const { viem } = await network.create();
    const [aliceWallet, bobWallet, authorizerWallet] =
      await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    const usdc = await viem.deployContract("MockUSDC");
    const escrow = await viem.deployContract("EmployeeLendingEscrow", [
      usdc.address,
      authorizerWallet.account.address,
    ]);

    const registration = await registerOrganizationAdmin(
      {
        name: "Pilot employer",
        email: `pilot-employer-${suffix}@example.test`,
        password: "local-test-password",
        organizationName: `Local lifecycle ${suffix}`,
        organizationSlug: `local-lifecycle-${suffix}`,
      },
      {
        passwordHasher: {
          hash: async () => "local-test-password-hash",
          verify: async () => true,
        },
        registrationRepository: prismaRegistrationRepository,
        sessionTokenService: {
          generate: () => `session-${suffix}`,
          hash: () => suffix.replaceAll("-", "").repeat(2),
        },
      },
    );
    organizationIds.push(registration.actor.organizationId);
    userIds.push(registration.actor.userId);

    async function createEmployee(
      name: string,
      emailPrefix: string,
    ): Promise<AuthenticatedActor> {
      const user = await prisma.user.create({
        data: {
          name,
          email: `${emailPrefix}-${suffix}@example.test`,
          passwordHash: "local-test-password-hash",
          memberships: {
            create: {
              organizationId: registration.actor.organizationId,
              role: "EMPLOYEE",
            },
          },
        },
      });
      userIds.push(user.id);
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        organizationId: registration.actor.organizationId,
        organizationName: registration.actor.organizationName,
        organizationSlug: registration.actor.organizationSlug,
        role: ApplicationRole.EMPLOYEE,
      };
    }

    const alice = await createEmployee("Alice", "alice");
    const bob = await createEmployee("Bob", "bob");

    async function enrollWallet(
      actor: AuthenticatedActor,
      wallet: typeof aliceWallet,
    ) {
      await beginArcWalletEnrollment(
        actor,
        "CREATE",
        prismaArcWalletRepository,
      );
      const challenge = await issueArcWalletChallenge(
        actor,
        wallet.account.address,
        {
          repository: prismaArcWalletRepository,
          createNonce: () => `nonce-${actor.userId}`,
        },
      );
      const signature = await wallet.signMessage({
        account: wallet.account,
        message: challenge.message,
      });
      return completeArcWalletChallenge(
        actor,
        {
          challengeId: challenge.challengeId,
          address: wallet.account.address,
          nonce: challenge.nonce,
          signature,
        },
        {
          repository: prismaArcWalletRepository,
          verifySignature: (input) => publicClient.verifyMessage(input),
        },
      );
    }

    const [aliceEnrollment, bobEnrollment] = await Promise.all([
      enrollWallet(alice, aliceWallet),
      enrollWallet(bob, bobWallet),
    ]);
    expect(aliceEnrollment.address).not.toBe(bobEnrollment.address);

    const principalBaseUnits = 100_000_000n;
    const interestBaseUnits = 5_000_000n;
    const repaymentBaseUnits = principalBaseUnits + interestBaseUnits;
    const aliceInitialBalance = 500_000_000n;
    await usdc.write.mint([aliceWallet.account.address, aliceInitialBalance]);

    const offerRequestId = randomUUID();
    const offerIntent = await prepareFundedLendingOffer(
      alice,
      {
        requestId: offerRequestId,
        principalBaseUnits,
        amountMinorUnits: 10_000n,
        feeRateBasisPoints: 500,
        durationDays: 30,
        durationSeconds: 30 * 86_400,
      },
      {
        contractAddress: escrow.address,
        readBalance: (address) => usdc.read.balanceOf([address]),
      },
    );
    await usdc.write.approve([escrow.address, principalBaseUnits], {
      account: aliceWallet.account,
    });
    const fundingHash = await escrow.write.createOffer(
      [principalBaseUnits, 500n, 30n * 86_400n, offerIntent.requestId],
      { account: aliceWallet.account },
    );
    await confirmFundedLendingOffer(alice, offerIntent.offerId, fundingHash, {
      contractAddress: escrow.address,
      getTransactionReceipt: ({ hash }) =>
        publicClient.getTransactionReceipt({ hash }),
    });

    const marketplace = await prismaLendingOfferRepository.listMarketplace({
      organizationId: bob.organizationId,
      userId: bob.userId,
      now: new Date(),
      filters: { sort: LendingMarketplaceSort.LOWEST_FEE },
    });
    expect(marketplace?.offers.map((offer) => offer.id)).toContain(
      offerIntent.offerId,
    );

    const borrowIntent = await prepareOnChainBorrow(
      bob,
      offerIntent.offerId,
      randomUUID(),
      {
        contractAddress: escrow.address,
        readOffer: (_address, offerId) => escrow.read.offers([offerId]),
        readAuthorizationSigner: () => escrow.read.authorizationSigner(),
        signAuthorization: async (authorization) => ({
          ...authorization,
          signerAddress: authorizerWallet.account.address,
          signature: await authorizerWallet.signTypedData({
            account: authorizerWallet.account,
            domain: {
              name: "EmployeeLendingEscrow",
              version: "1",
              chainId,
              verifyingContract: escrow.address,
            },
            types: {
              BorrowAuthorization: [
                { name: "offerId", type: "uint256" },
                { name: "borrower", type: "address" },
                { name: "expiry", type: "uint256" },
                { name: "authorizationId", type: "bytes32" },
              ],
            },
            primaryType: "BorrowAuthorization",
            message: authorization,
          }),
        }),
      },
    );
    if (borrowIntent.state !== "PENDING") {
      throw new Error("Expected a pending borrowing intent.");
    }
    const acceptanceHash = await escrow.write.acceptOffer(
      [
        BigInt(borrowIntent.chainOfferId),
        BigInt(borrowIntent.authorizationExpiry),
        borrowIntent.authorizationId,
        borrowIntent.authorizationSignature,
      ],
      { account: bobWallet.account },
    );
    await confirmOnChainBorrow(bob, borrowIntent.loanId, acceptanceHash, {
      contractAddress: escrow.address,
      getTransactionReceipt: ({ hash }) =>
        publicClient.getTransactionReceipt({ hash }),
      readLoan: (_address, loanId) => escrow.read.loans([loanId]),
    });
    expect(await usdc.read.balanceOf([bobWallet.account.address])).toBe(
      principalBaseUnits,
    );

    await usdc.write.mint([bobWallet.account.address, interestBaseUnits]);
    const repaymentIntent = await prepareOnChainRepayment(
      bob,
      borrowIntent.loanId,
      randomUUID(),
      {
        contractAddress: escrow.address,
        readLoan: (_address, loanId) => escrow.read.loans([loanId]),
        readBalance: (address) => usdc.read.balanceOf([address]),
      },
    );
    if (repaymentIntent.state !== "PENDING") {
      throw new Error("Expected a pending repayment intent.");
    }
    await usdc.write.approve([escrow.address, repaymentBaseUnits], {
      account: bobWallet.account,
    });
    const repaymentHash = await escrow.write.repayLoan(
      [BigInt(repaymentIntent.chainLoanId)],
      { account: bobWallet.account },
    );
    await confirmOnChainRepayment(
      bob,
      borrowIntent.loanId,
      repaymentIntent.repaymentId,
      repaymentHash,
      {
        contractAddress: escrow.address,
        getTransactionReceipt: ({ hash }) =>
          publicClient.getTransactionReceipt({ hash }),
        readLoan: (_address, loanId) => escrow.read.loans([loanId]),
      },
    );

    const [databaseLoan, chainLoan, aliceFinalBalance, escrowBalance] =
      await Promise.all([
        prisma.loan.findUniqueOrThrow({
          where: { id: borrowIntent.loanId },
          include: { repayments: true },
        }),
        escrow.read.loans([BigInt(repaymentIntent.chainLoanId)]),
        usdc.read.balanceOf([aliceWallet.account.address]),
        usdc.read.balanceOf([escrow.address]),
      ]);
    expect(databaseLoan).toMatchObject({
      organizationId: registration.actor.organizationId,
      status: "REPAID",
      outstandingPrincipalMinorUnits: 0n,
      principalAmountMinorUnits: 10_000n,
      feeAmountMinorUnits: 500n,
    });
    expect(databaseLoan.repayments).toHaveLength(1);
    expect(databaseLoan.repayments[0]).toMatchObject({
      status: "COMPLETED",
      amountMinorUnits: 10_500n,
    });
    expect(chainLoan[9]).toBe(1);
    expect(chainLoan[10]).toBeGreaterThan(0n);
    expect(aliceFinalBalance).toBe(aliceInitialBalance + interestBaseUnits);
    expect(await usdc.read.balanceOf([bobWallet.account.address])).toBe(0n);
    expect(escrowBalance).toBe(0n);
  }, 60_000);
});
