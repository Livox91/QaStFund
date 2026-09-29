import "server-only";

import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Hex,
} from "viem";

import { prisma } from "@/infrastructure/database/prisma";
import { logger } from "@/infrastructure/logging/logger";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  ARC_TESTNET_RPC_URL,
  arcTestnet,
} from "@/integrations/arc/arc-testnet";
import {
  employeeLendingEscrowAbi,
  getConfiguredEscrowAddress,
} from "@/integrations/arc/employee-lending-escrow";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { calculateOnChainRepaymentBaseUnits } from "@/modules/loans/domain/onchain-borrow";
import {
  policySnapshot,
  validateBorrowAgainstPolicy,
} from "@/modules/policies/domain/lending-policy";
import {
  calculateBorrowerObligations,
  ensureOrganizationPolicy,
} from "@/modules/policies/infrastructure/policy-data";
import { ApplicationError } from "@/shared/errors/application-error";
import { USDC_BASE_UNITS_PER_CENT } from "@/shared/money/usdc";

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC_URL),
});

function unavailableError() {
  return new ApplicationError(
    "LENDING_OFFER_NOT_AVAILABLE",
    "This offer is no longer available. Choose another lending offer.",
    409,
  );
}

function configurationError() {
  return new ApplicationError(
    "LENDING_ESCROW_NOT_CONFIGURED",
    "Lending escrow is not configured for Arc Testnet.",
    503,
  );
}

function baseUnitsToMinorUnitsRoundedUp(value: bigint): bigint {
  return (value + USDC_BASE_UNITS_PER_CENT - 1n) / USDC_BASE_UNITS_PER_CENT;
}

export async function prepareOnChainBorrow(
  actor: AuthenticatedActor,
  offerId: string,
  requestId: string,
) {
  const configuredContract = getConfiguredEscrowAddress();
  if (!configuredContract) throw configurationError();

  const existing = await prisma.loan.findUnique({
    where: { borrowRequestId: requestId },
    select: {
      id: true,
      organizationId: true,
      borrowerMembership: { select: { userId: true } },
      lendingOfferId: true,
      chainOfferId: true,
      contractAddress: true,
      status: true,
    },
  });
  if (existing) {
    if (
      existing.organizationId !== actor.organizationId ||
      existing.borrowerMembership.userId !== actor.userId ||
      existing.lendingOfferId !== offerId ||
      existing.chainOfferId === null ||
      existing.contractAddress === null
    ) {
      throw new ApplicationError(
        "BORROW_REQUEST_CONFLICT",
        "This borrowing request has already been used.",
        409,
      );
    }
    if (existing.status !== "REQUESTED") throw unavailableError();
    return {
      loanId: existing.id,
      contractAddress: getAddress(existing.contractAddress),
      chainOfferId: existing.chainOfferId,
    };
  }

  const now = new Date();
  const context = await prisma.$transaction(async (transaction) => {
    const membership = await transaction.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: actor.organizationId,
          userId: actor.userId,
        },
      },
      select: {
        id: true,
        isActive: true,
        employmentStatus: true,
        role: true,
        canBorrow: true,
        user: { select: { name: true } },
      },
    });
    if (
      !membership?.isActive ||
      membership.employmentStatus !== "ACTIVE" ||
      membership.role !== "EMPLOYEE" ||
      !membership.canBorrow
    ) {
      throw unavailableError();
    }

    const wallet = await transaction.arcWallet.findUnique({
      where: {
        userId_network: {
          userId: actor.userId,
          network: ARC_TESTNET_NETWORK,
        },
      },
      select: {
        address: true,
        status: true,
        chainId: true,
        organizationId: true,
      },
    });
    if (
      !wallet?.address ||
      wallet.status !== "ACTIVE" ||
      wallet.chainId !== ARC_TESTNET_CHAIN_ID ||
      wallet.organizationId !== actor.organizationId
    ) {
      throw new ApplicationError(
        "ARC_WALLET_NOT_READY",
        "Your Arc wallet must be ready before borrowing.",
        409,
      );
    }

    const offer = await transaction.lendingOffer.findFirst({
      where: {
        id: offerId,
        organizationId: actor.organizationId,
        lenderMembershipId: { not: membership.id },
        status: "ACTIVE",
        fundingStatus: "FUNDED",
        expiresAt: { gt: now },
        availableAmountMinorUnits: { gt: 0n },
        lenderMembership: {
          isActive: true,
          employmentStatus: "ACTIVE",
          canLend: true,
        },
      },
      select: {
        id: true,
        organizationId: true,
        lenderMembershipId: true,
        amountMinorUnits: true,
        currency: true,
        durationDays: true,
        feeRateBasisPoints: true,
        lenderWalletAddress: true,
        principalBaseUnits: true,
        chainOfferId: true,
        contractAddress: true,
      },
    });
    if (
      !offer?.lenderWalletAddress ||
      offer.principalBaseUnits === null ||
      !offer.chainOfferId ||
      offer.contractAddress?.toLowerCase() !== configuredContract.toLowerCase()
    ) {
      throw unavailableError();
    }

    const policy = await ensureOrganizationPolicy(
      transaction,
      actor.organizationId,
    );
    const obligations = await calculateBorrowerObligations(
      transaction,
      actor.organizationId,
      membership.id,
    );
    const violation = validateBorrowAgainstPolicy(policy, membership, {
      amountMinorUnits: offer.amountMinorUnits,
      ...obligations,
    });
    if (violation) {
      throw new ApplicationError(
        "BORROWING_POLICY_VIOLATION",
        `This loan is not eligible under organization policy: ${violation}.`,
        422,
      );
    }

    return { membership, wallet, offer, policy };
  });

  const chainOfferId = context.offer.chainOfferId;
  const lenderWalletAddress = context.offer.lenderWalletAddress;
  const principalBaseUnits = context.offer.principalBaseUnits;
  const borrowerWalletAddress = context.wallet.address;
  if (
    !chainOfferId ||
    !lenderWalletAddress ||
    principalBaseUnits === null ||
    !borrowerWalletAddress
  ) {
    throw unavailableError();
  }

  const chainOffer = await client.readContract({
    address: configuredContract,
    abi: employeeLendingEscrowAbi,
    functionName: "offers",
    args: [BigInt(chainOfferId)],
  });
  if (
    chainOffer[0] !== BigInt(chainOfferId) ||
    chainOffer[1].toLowerCase() !== lenderWalletAddress.toLowerCase() ||
    chainOffer[2] !== principalBaseUnits ||
    chainOffer[3] !== BigInt(context.offer.feeRateBasisPoints) ||
    chainOffer[4] !== BigInt(context.offer.durationDays * 86_400) ||
    !chainOffer[5]
  ) {
    throw unavailableError();
  }

  const repaymentBaseUnits = calculateOnChainRepaymentBaseUnits(
    principalBaseUnits,
    context.offer.feeRateBasisPoints,
  );
  const repaymentMinorUnits =
    baseUnitsToMinorUnitsRoundedUp(repaymentBaseUnits);
  const feeMinorUnits =
    repaymentMinorUnits > context.offer.amountMinorUnits
      ? repaymentMinorUnits - context.offer.amountMinorUnits
      : 0n;
  const estimatedDueAt = new Date(
    now.getTime() + context.offer.durationDays * 86_400_000,
  );

  const loan = await prisma.loan.create({
    data: {
      organizationId: actor.organizationId,
      lenderMembershipId: context.offer.lenderMembershipId,
      borrowerMembershipId: context.membership.id,
      lendingOfferId: context.offer.id,
      borrowRequestId: requestId,
      chainOfferId,
      contractAddress: configuredContract.toLowerCase(),
      lenderWalletAddress: lenderWalletAddress.toLowerCase(),
      borrowerWalletAddress: borrowerWalletAddress.toLowerCase(),
      principalBaseUnits,
      repaymentBaseUnits,
      principalAmountMinorUnits: context.offer.amountMinorUnits,
      feeAmountMinorUnits: feeMinorUnits,
      outstandingPrincipalMinorUnits: context.offer.amountMinorUnits,
      currency: context.offer.currency,
      durationDays: context.offer.durationDays,
      feeRateBasisPoints: context.offer.feeRateBasisPoints,
      status: "REQUESTED",
      requestedAt: now,
      startedAt: now,
      repaymentDueAt: estimatedDueAt,
      policyVersion: context.policy.policyVersion,
      policySnapshot: policySnapshot(context.policy),
    },
    select: { id: true },
  });

  return {
    loanId: loan.id,
    contractAddress: configuredContract,
    chainOfferId,
  };
}

export async function confirmOnChainBorrow(
  actor: AuthenticatedActor,
  loanId: string,
  transactionHash: Hex,
) {
  const configuredContract = getConfiguredEscrowAddress();
  if (!configuredContract) throw configurationError();
  const pending = await prisma.loan.findFirst({
    where: {
      id: loanId,
      organizationId: actor.organizationId,
      borrowerMembership: { userId: actor.userId },
    },
    select: {
      id: true,
      status: true,
      lendingOfferId: true,
      chainLoanId: true,
      chainOfferId: true,
      lenderWalletAddress: true,
      borrowerWalletAddress: true,
      principalBaseUnits: true,
      repaymentBaseUnits: true,
      feeRateBasisPoints: true,
      durationDays: true,
      acceptanceTransactionHash: true,
    },
  });
  if (!pending?.lendingOfferId) throw unavailableError();
  if (pending.status === "ACTIVE") {
    if (
      pending.acceptanceTransactionHash?.toLowerCase() !==
      transactionHash.toLowerCase()
    ) {
      throw unavailableError();
    }
    return { loanId: pending.id, status: "ACTIVE" as const };
  }
  if (
    pending.status !== "REQUESTED" ||
    !pending.chainOfferId ||
    !pending.lenderWalletAddress ||
    !pending.borrowerWalletAddress ||
    pending.principalBaseUnits === null ||
    pending.repaymentBaseUnits === null
  ) {
    throw unavailableError();
  }

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: transactionHash });
  } catch (error) {
    logger.error("Arc loan receipt is not available yet", error, { loanId });
    throw new ApplicationError(
      "LOAN_CONFIRMATION_PENDING",
      "The transfer is still being confirmed. Try again shortly.",
      409,
    );
  }
  if (receipt.status !== "success") {
    await prisma.loan.updateMany({
      where: { id: pending.id, status: "REQUESTED" },
      data: { status: "CANCELLED", closedAt: new Date() },
    });
    throw unavailableError();
  }

  let event:
    | {
        loanId: bigint;
        offerId: bigint;
        lender: `0x${string}`;
        borrower: `0x${string}`;
        principal: bigint;
        repaymentAmount: bigint;
        startTime: bigint;
        dueTime: bigint;
      }
    | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== configuredContract.toLowerCase())
      continue;
    try {
      const decoded = decodeEventLog({
        abi: employeeLendingEscrowAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        decoded.eventName === "LoanStarted" &&
        decoded.args.offerId === BigInt(pending.chainOfferId)
      ) {
        event = decoded.args;
        break;
      }
    } catch {
      // The receipt also contains account-abstraction and USDC logs.
    }
  }
  if (
    !event ||
    event.lender.toLowerCase() !== pending.lenderWalletAddress ||
    event.borrower.toLowerCase() !== pending.borrowerWalletAddress ||
    event.principal !== pending.principalBaseUnits ||
    event.repaymentAmount !== pending.repaymentBaseUnits ||
    event.dueTime - event.startTime !== BigInt(pending.durationDays * 86_400)
  ) {
    throw new ApplicationError(
      "INVALID_LOAN_CONFIRMATION",
      "The confirmed transaction does not match this loan.",
      400,
    );
  }

  const chainLoan = await client.readContract({
    address: configuredContract,
    abi: employeeLendingEscrowAbi,
    functionName: "loans",
    args: [event.loanId],
  });
  if (
    chainLoan[0] !== event.loanId ||
    chainLoan[1] !== event.offerId ||
    chainLoan[2].toLowerCase() !== event.lender.toLowerCase() ||
    chainLoan[3].toLowerCase() !== event.borrower.toLowerCase() ||
    chainLoan[9] !== 0
  ) {
    throw new ApplicationError(
      "INVALID_LOAN_CONFIRMATION",
      "The on-chain loan state could not be verified.",
      400,
    );
  }

  const startedAt = new Date(Number(event.startTime) * 1_000);
  const dueAt = new Date(Number(event.dueTime) * 1_000);
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.loan.updateMany({
      where: { id: pending.id, status: "REQUESTED" },
      data: {
        status: "ACTIVE",
        chainLoanId: event.loanId.toString(),
        acceptanceTransactionHash: transactionHash.toLowerCase(),
        approvedAt: startedAt,
        activatedAt: startedAt,
        startedAt,
        repaymentDueAt: dueAt,
        onChainStartedAt: startedAt,
        onChainDueAt: dueAt,
      },
    });
    if (updated.count !== 1) throw unavailableError();

    await transaction.lendingOffer.update({
      where: { id: pending.lendingOfferId! },
      data: { status: "EXHAUSTED", availableAmountMinorUnits: 0n },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: actor.organizationId,
        loanId: pending.id,
        lendingOfferId: pending.lendingOfferId,
        amountMinorUnits: baseUnitsToMinorUnitsRoundedUp(event.principal),
        currency: "USD",
        type: "LOAN_ACTIVATED",
        title: "Escrow released and loan activated",
        occurredAt: startedAt,
        metadata: {
          chainLoanId: event.loanId.toString(),
          transactionHash: transactionHash.toLowerCase(),
        },
      },
    });
  });

  return { loanId: pending.id, status: "ACTIVE" as const };
}
