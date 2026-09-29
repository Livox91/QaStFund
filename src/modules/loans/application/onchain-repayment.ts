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
  ARC_USDC_ADDRESS,
  arcTestnet,
} from "@/integrations/arc/arc-testnet";
import {
  employeeLendingEscrowAbi,
  erc20UsdcAbi,
  getConfiguredEscrowAddress,
} from "@/integrations/arc/employee-lending-escrow";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationError } from "@/shared/errors/application-error";
import { USDC_BASE_UNITS_PER_CENT } from "@/shared/money/usdc";

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC_URL),
});

function configurationError() {
  return new ApplicationError(
    "LENDING_ESCROW_NOT_CONFIGURED",
    "Lending escrow is not configured for Arc Testnet.",
    503,
  );
}

function unavailableError() {
  return new ApplicationError(
    "LOAN_NOT_REPAYABLE",
    "This loan is not available for repayment.",
    409,
  );
}

function baseUnitsToMinorUnitsRoundedUp(value: bigint): bigint {
  return (value + USDC_BASE_UNITS_PER_CENT - 1n) / USDC_BASE_UNITS_PER_CENT;
}

export async function prepareOnChainRepayment(
  actor: AuthenticatedActor,
  loanId: string,
  requestId: string,
) {
  const configuredContract = getConfiguredEscrowAddress();
  if (!configuredContract) throw configurationError();

  const existing = await prisma.loanRepayment.findUnique({
    where: { repaymentRequestId: requestId },
    select: {
      id: true,
      status: true,
      loan: {
        select: {
          id: true,
          organizationId: true,
          borrowerMembership: { select: { userId: true } },
          chainLoanId: true,
          repaymentBaseUnits: true,
          contractAddress: true,
        },
      },
    },
  });
  if (existing) {
    if (
      existing.loan.id !== loanId ||
      existing.loan.organizationId !== actor.organizationId ||
      existing.loan.borrowerMembership.userId !== actor.userId ||
      existing.status !== "PENDING" ||
      !existing.loan.chainLoanId ||
      existing.loan.repaymentBaseUnits === null ||
      !existing.loan.contractAddress
    ) {
      throw unavailableError();
    }
    return {
      repaymentId: existing.id,
      contractAddress: getAddress(existing.loan.contractAddress),
      chainLoanId: existing.loan.chainLoanId,
      usdcAddress: ARC_USDC_ADDRESS,
      repaymentBaseUnits: existing.loan.repaymentBaseUnits.toString(),
    };
  }

  const context = await prisma.loan.findFirst({
    where: {
      id: loanId,
      organizationId: actor.organizationId,
      status: "ACTIVE",
      borrowerMembership: {
        userId: actor.userId,
        isActive: true,
        employmentStatus: "ACTIVE",
      },
    },
    select: {
      id: true,
      organizationId: true,
      currency: true,
      chainLoanId: true,
      chainOfferId: true,
      contractAddress: true,
      lenderWalletAddress: true,
      borrowerWalletAddress: true,
      principalBaseUnits: true,
      repaymentBaseUnits: true,
      borrowerMembership: { select: { id: true } },
    },
  });
  if (
    !context?.chainLoanId ||
    !context.chainOfferId ||
    context.contractAddress?.toLowerCase() !==
      configuredContract.toLowerCase() ||
    !context.lenderWalletAddress ||
    !context.borrowerWalletAddress ||
    context.principalBaseUnits === null ||
    context.repaymentBaseUnits === null
  ) {
    throw unavailableError();
  }

  const wallet = await prisma.arcWallet.findUnique({
    where: {
      userId_network: { userId: actor.userId, network: ARC_TESTNET_NETWORK },
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
    wallet.organizationId !== actor.organizationId ||
    wallet.address.toLowerCase() !== context.borrowerWalletAddress.toLowerCase()
  ) {
    throw new ApplicationError(
      "ARC_WALLET_NOT_READY",
      "Your Arc wallet must be ready before repaying.",
      409,
    );
  }

  const chainLoan = await client.readContract({
    address: configuredContract,
    abi: employeeLendingEscrowAbi,
    functionName: "loans",
    args: [BigInt(context.chainLoanId)],
  });
  if (
    chainLoan[0] !== BigInt(context.chainLoanId) ||
    chainLoan[1] !== BigInt(context.chainOfferId) ||
    chainLoan[2].toLowerCase() !== context.lenderWalletAddress.toLowerCase() ||
    chainLoan[3].toLowerCase() !==
      context.borrowerWalletAddress.toLowerCase() ||
    chainLoan[4] !== context.principalBaseUnits ||
    chainLoan[6] !== context.repaymentBaseUnits ||
    chainLoan[9] !== 0 ||
    chainLoan[10] !== 0n
  ) {
    throw unavailableError();
  }

  const balanceBaseUnits = await client.readContract({
    address: ARC_USDC_ADDRESS,
    abi: erc20UsdcAbi,
    functionName: "balanceOf",
    args: [getAddress(wallet.address)],
  });
  if (balanceBaseUnits < context.repaymentBaseUnits) {
    throw new ApplicationError(
      "INSUFFICIENT_USDC_BALANCE",
      "Your USDC balance is too low to repay this loan in full.",
      409,
    );
  }

  const repayment = await prisma.$transaction(async (transaction) => {
    const pending = await transaction.loanRepayment.findFirst({
      where: {
        loanId,
        organizationId: actor.organizationId,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (pending) return pending;

    return transaction.loanRepayment.create({
      data: {
        organizationId: actor.organizationId,
        loanId,
        repaymentRequestId: requestId,
        amountMinorUnits: baseUnitsToMinorUnitsRoundedUp(
          context.repaymentBaseUnits!,
        ),
        currency: context.currency,
        status: "PENDING",
        paidAt: new Date(),
      },
      select: { id: true },
    });
  });

  return {
    repaymentId: repayment.id,
    contractAddress: configuredContract,
    chainLoanId: context.chainLoanId,
    usdcAddress: ARC_USDC_ADDRESS,
    repaymentBaseUnits: context.repaymentBaseUnits.toString(),
    balanceBaseUnits: balanceBaseUnits.toString(),
  };
}

export async function confirmOnChainRepayment(
  actor: AuthenticatedActor,
  loanId: string,
  repaymentId: string,
  transactionHash: Hex,
) {
  const configuredContract = getConfiguredEscrowAddress();
  if (!configuredContract) throw configurationError();

  const pending = await prisma.loanRepayment.findFirst({
    where: {
      id: repaymentId,
      loanId,
      organizationId: actor.organizationId,
      loan: { borrowerMembership: { userId: actor.userId } },
    },
    select: {
      id: true,
      status: true,
      loan: {
        select: {
          id: true,
          status: true,
          chainLoanId: true,
          contractAddress: true,
          lenderWalletAddress: true,
          borrowerWalletAddress: true,
          repaymentBaseUnits: true,
          repaymentTransactionHash: true,
          borrowerMembershipId: true,
          lenderMembershipId: true,
          currency: true,
        },
      },
    },
  });
  if (!pending) throw unavailableError();
  if (
    pending.status === "COMPLETED" &&
    pending.loan.status === "REPAID" &&
    pending.loan.repaymentTransactionHash?.toLowerCase() ===
      transactionHash.toLowerCase()
  ) {
    return { loanId, status: "REPAID" as const };
  }
  if (
    pending.status !== "PENDING" ||
    pending.loan.status !== "ACTIVE" ||
    !pending.loan.chainLoanId ||
    pending.loan.contractAddress?.toLowerCase() !==
      configuredContract.toLowerCase() ||
    !pending.loan.lenderWalletAddress ||
    !pending.loan.borrowerWalletAddress ||
    pending.loan.repaymentBaseUnits === null
  ) {
    throw unavailableError();
  }

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: transactionHash });
  } catch (error) {
    logger.error("Arc repayment receipt is not available yet", error, {
      loanId,
      repaymentId,
    });
    throw new ApplicationError(
      "REPAYMENT_CONFIRMATION_PENDING",
      "The repayment is still being confirmed. Try again shortly.",
      409,
    );
  }
  if (receipt.status !== "success") {
    await prisma.loanRepayment.updateMany({
      where: { id: repaymentId, status: "PENDING" },
      data: { status: "FAILED" },
    });
    throw new ApplicationError(
      "REPAYMENT_FAILED",
      "The repayment did not complete. No loan state was changed.",
      409,
    );
  }

  let event:
    | {
        loanId: bigint;
        borrower: `0x${string}`;
        lender: `0x${string}`;
        amount: bigint;
        repaidAt: bigint;
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
        decoded.eventName === "LoanRepaid" &&
        decoded.args.loanId === BigInt(pending.loan.chainLoanId)
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
    event.borrower.toLowerCase() !== pending.loan.borrowerWalletAddress ||
    event.lender.toLowerCase() !== pending.loan.lenderWalletAddress ||
    event.amount !== pending.loan.repaymentBaseUnits
  ) {
    throw new ApplicationError(
      "INVALID_REPAYMENT_CONFIRMATION",
      "The confirmed transaction does not match this loan repayment.",
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
    chainLoan[2].toLowerCase() !== event.lender.toLowerCase() ||
    chainLoan[3].toLowerCase() !== event.borrower.toLowerCase() ||
    chainLoan[6] !== event.amount ||
    chainLoan[9] !== 1 ||
    chainLoan[10] !== event.repaidAt
  ) {
    throw new ApplicationError(
      "INVALID_REPAYMENT_CONFIRMATION",
      "The on-chain repayment state could not be verified.",
      400,
    );
  }

  const repaidAt = new Date(Number(event.repaidAt) * 1_000);
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.loan.updateMany({
      where: { id: loanId, status: "ACTIVE" },
      data: {
        status: "REPAID",
        outstandingPrincipalMinorUnits: 0n,
        closedAt: repaidAt,
        onChainRepaidAt: repaidAt,
        repaymentTransactionHash: transactionHash.toLowerCase(),
      },
    });
    if (updated.count !== 1) throw unavailableError();

    await transaction.loanRepayment.update({
      where: { id: repaymentId },
      data: { status: "COMPLETED", paidAt: repaidAt, completedAt: repaidAt },
    });
    await transaction.auditEvent.createMany({
      data: [
        {
          organizationId: actor.organizationId,
          loanId,
          repaymentId,
          actorMembershipId: pending.loan.borrowerMembershipId,
          targetMembershipId: pending.loan.lenderMembershipId,
          amountMinorUnits: baseUnitsToMinorUnitsRoundedUp(event.amount),
          currency: pending.loan.currency,
          type: "REPAYMENT_COMPLETED",
          title: "On-chain repayment completed",
          occurredAt: repaidAt,
          metadata: {
            chainLoanId: event.loanId.toString(),
            transactionHash: transactionHash.toLowerCase(),
          },
        },
        {
          organizationId: actor.organizationId,
          loanId,
          repaymentId,
          actorMembershipId: pending.loan.borrowerMembershipId,
          targetMembershipId: pending.loan.lenderMembershipId,
          amountMinorUnits: baseUnitsToMinorUnitsRoundedUp(event.amount),
          currency: pending.loan.currency,
          type: "LOAN_REPAID",
          title: "Loan repaid in full",
          occurredAt: repaidAt,
          metadata: {
            chainLoanId: event.loanId.toString(),
            transactionHash: transactionHash.toLowerCase(),
          },
        },
      ],
    });
  });

  return { loanId, status: "REPAID" as const };
}
