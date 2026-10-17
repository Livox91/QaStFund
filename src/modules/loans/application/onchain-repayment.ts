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
  logTransactionLifecycle,
  operationalFailureAlertThreshold,
  recordOperationalFailure,
  recordOperationalSuccess,
} from "@/infrastructure/observability/operational-signals";
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
import {
  escrowV3Abi,
  getConfiguredEscrowVersion,
} from "@/integrations/arc/escrow-v3";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationError } from "@/shared/errors/application-error";
import { USDC_BASE_UNITS_PER_CENT } from "@/shared/money/usdc";

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC_URL),
});

async function readChainLoan(
  contractAddress: `0x${string}`,
  chainLoanId: bigint,
) {
  return client.readContract({
    address: contractAddress,
    abi: employeeLendingEscrowAbi,
    functionName: "loans",
    args: [chainLoanId],
  });
}

/** On-chain amount already repaid; V1 escrows only support full repayment. */
async function readRepaidBaseUnits(
  contractAddress: `0x${string}`,
  chainLoanId: bigint,
) {
  if (getConfiguredEscrowVersion() !== "3") return 0n;
  return client.readContract({
    address: contractAddress,
    abi: escrowV3Abi,
    functionName: "repaidAmounts",
    args: [chainLoanId],
  });
}

/** Agreed total minus completed repayments, in integer cents. */
async function remainingRepaymentMinorUnits(
  database: typeof prisma,
  loanId: string,
) {
  const loan = await database.loan.findUniqueOrThrow({
    where: { id: loanId },
    select: {
      principalAmountMinorUnits: true,
      feeAmountMinorUnits: true,
      repayments: {
        where: { status: "COMPLETED" },
        select: { amountMinorUnits: true },
      },
    },
  });
  const repaid = loan.repayments.reduce(
    (sum, item) => sum + item.amountMinorUnits,
    0n,
  );
  return loan.principalAmountMinorUnits + loan.feeAmountMinorUnits - repaid;
}

async function readUsdcBalance(walletAddress: `0x${string}`) {
  return client.readContract({
    address: ARC_USDC_ADDRESS,
    abi: erc20UsdcAbi,
    functionName: "balanceOf",
    args: [walletAddress],
  });
}

type PrepareOnChainRepaymentDependencies = Readonly<{
  contractAddress?: `0x${string}`;
  database?: typeof prisma;
  now?: () => Date;
  readBalance?: typeof readUsdcBalance;
  readLoan?: typeof readChainLoan;
  readRepaid?: typeof readRepaidBaseUnits;
}>;

type ConfirmOnChainRepaymentDependencies = Readonly<{
  contractAddress?: `0x${string}`;
  database?: typeof prisma;
  getTransactionReceipt?: typeof client.getTransactionReceipt;
  readLoan?: typeof readChainLoan;
}>;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function repaymentIntentConflictError() {
  return new ApplicationError(
    "REPAYMENT_INTENT_CONFLICT",
    "Another repayment attempt is already in progress for this loan.",
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

export function resolveLifecycleRepaidAt(
  onChainRepaidAt: Date,
  loanStartedAt: Date,
  repaymentInitiatedAt: Date,
): Date {
  return new Date(
    Math.max(
      onChainRepaidAt.getTime(),
      loanStartedAt.getTime(),
      repaymentInitiatedAt.getTime(),
    ),
  );
}

export async function prepareOnChainRepayment(
  actor: AuthenticatedActor,
  loanId: string,
  requestId: string,
  dependencies: PrepareOnChainRepaymentDependencies = {},
) {
  const database = dependencies.database ?? prisma;
  const configuredContract =
    dependencies.contractAddress ?? getConfiguredEscrowAddress();
  if (!configuredContract) throw configurationError();

  const existing = await database.loanRepayment.findUnique({
    where: { repaymentRequestId: requestId },
    select: {
      id: true,
      amountMinorUnits: true,
      status: true,
      submissionTransactionHash: true,
      loan: {
        select: {
          id: true,
          status: true,
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
      existing.loan.borrowerMembership.userId !== actor.userId
    ) {
      throw new ApplicationError(
        "REPAYMENT_REQUEST_CONFLICT",
        "This repayment request has already been used.",
        409,
      );
    }
    if (
      !existing.loan.chainLoanId ||
      existing.loan.repaymentBaseUnits === null ||
      !existing.loan.contractAddress
    ) {
      throw unavailableError();
    }
    if (existing.status !== "COMPLETED") {
      // V3 loans may have received partial repayments since this intent was
      // created; an intent must always cover exactly the remaining balance.
      const expectedMinor = await remainingRepaymentMinorUnits(
        database,
        existing.loan.id,
      );
      if (existing.amountMinorUnits !== expectedMinor) {
        if (
          existing.status === "PENDING" &&
          existing.submissionTransactionHash
        ) {
          throw new ApplicationError(
            "REPAYMENT_REQUEST_CONFLICT",
            "This repayment request has already been used.",
            409,
          );
        }
        await database.loanRepayment.updateMany({
          where: { id: existing.id, submissionTransactionHash: null },
          data: { amountMinorUnits: expectedMinor },
        });
      }
    }
    if (existing.status === "COMPLETED") {
      if (existing.loan.status !== "REPAID") throw unavailableError();
      return {
        state: "CONFIRMED" as const,
        repaymentId: existing.id,
        loanId: existing.loan.id,
      };
    }
    if (existing.status === "PENDING") {
      const repaid = await (dependencies.readRepaid ?? readRepaidBaseUnits)(
        getAddress(existing.loan.contractAddress),
        BigInt(existing.loan.chainLoanId),
      );
      return {
        state: "PENDING" as const,
        repaymentId: existing.id,
        contractAddress: getAddress(existing.loan.contractAddress),
        chainLoanId: existing.loan.chainLoanId,
        usdcAddress: ARC_USDC_ADDRESS,
        repaymentBaseUnits: (
          existing.loan.repaymentBaseUnits - repaid
        ).toString(),
      };
    }
    if (existing.status !== "FAILED" && existing.status !== "CANCELLED") {
      throw unavailableError();
    }
  } else {
    const competing = await database.loanRepayment.findFirst({
      where: {
        loanId,
        organizationId: actor.organizationId,
        status: "PENDING",
      },
      select: { repaymentRequestId: true },
    });
    if (competing && competing.repaymentRequestId !== requestId) {
      throw repaymentIntentConflictError();
    }
  }

  const context = await database.loan.findFirst({
    where: {
      id: loanId,
      organizationId: actor.organizationId,
      status: { in: ["ACTIVE", "OVERDUE"] },
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

  const wallet = await database.arcWallet.findUnique({
    where: {
      userId_network: { userId: actor.userId, network: ARC_TESTNET_NETWORK },
    },
    select: {
      address: true,
      status: true,
      chainId: true,
    },
  });
  if (
    !wallet?.address ||
    wallet.status !== "ACTIVE" ||
    wallet.chainId !== ARC_TESTNET_CHAIN_ID ||
    wallet.address.toLowerCase() !== context.borrowerWalletAddress.toLowerCase()
  ) {
    throw new ApplicationError(
      "ARC_WALLET_NOT_READY",
      "Your Arc wallet must be ready before repaying.",
      409,
    );
  }

  const chainLoan = await (dependencies.readLoan ?? readChainLoan)(
    configuredContract,
    BigInt(context.chainLoanId),
  );
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

  const repaidBaseUnits = await (
    dependencies.readRepaid ?? readRepaidBaseUnits
  )(configuredContract, BigInt(context.chainLoanId));
  const remainingBaseUnits = context.repaymentBaseUnits - repaidBaseUnits;
  if (remainingBaseUnits <= 0n) throw unavailableError();
  const balanceBaseUnits = await (dependencies.readBalance ?? readUsdcBalance)(
    getAddress(wallet.address),
  );
  if (balanceBaseUnits < remainingBaseUnits) {
    throw new ApplicationError(
      "INSUFFICIENT_USDC_BALANCE",
      "Your USDC balance is too low to repay this loan in full.",
      409,
    );
  }

  const amountMinorUnits =
    repaidBaseUnits === 0n
      ? baseUnitsToMinorUnitsRoundedUp(context.repaymentBaseUnits)
      : await remainingRepaymentMinorUnits(database, context.id);
  const paidAt = dependencies.now?.() ?? new Date();
  let repayment: { id: string };
  try {
    if (existing) {
      const revived = await database.loanRepayment.updateMany({
        where: {
          id: existing.id,
          status: { in: ["FAILED", "CANCELLED"] },
        },
        data: {
          status: "PENDING",
          amountMinorUnits,
          paidAt,
          completedAt: null,
          submissionTransactionHash: null,
        },
      });
      if (revived.count === 1) {
        repayment = existing;
      } else {
        const current = await database.loanRepayment.findUnique({
          where: { repaymentRequestId: requestId },
          select: { id: true, status: true },
        });
        if (current?.status !== "PENDING") {
          throw repaymentIntentConflictError();
        }
        repayment = current;
      }
    } else {
      repayment = await database.loanRepayment.create({
        data: {
          organizationId: actor.organizationId,
          loanId,
          repaymentRequestId: requestId,
          amountMinorUnits,
          currency: context.currency,
          status: "PENDING",
          paidAt,
        },
        select: { id: true },
      });
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const sameRequest = await database.loanRepayment.findUnique({
      where: { repaymentRequestId: requestId },
      select: {
        id: true,
        status: true,
        loan: {
          select: {
            id: true,
            organizationId: true,
            borrowerMembership: { select: { userId: true } },
          },
        },
      },
    });
    if (
      sameRequest?.loan.id === loanId &&
      sameRequest.loan.organizationId === actor.organizationId &&
      sameRequest.loan.borrowerMembership.userId === actor.userId
    ) {
      if (sameRequest.status === "COMPLETED") {
        return {
          state: "CONFIRMED" as const,
          repaymentId: sameRequest.id,
          loanId,
        };
      }
      if (sameRequest.status === "PENDING") {
        repayment = sameRequest;
      } else {
        throw repaymentIntentConflictError();
      }
    } else {
      throw repaymentIntentConflictError();
    }
  }

  return {
    state: "PENDING" as const,
    repaymentId: repayment.id,
    contractAddress: configuredContract,
    chainLoanId: context.chainLoanId,
    usdcAddress: ARC_USDC_ADDRESS,
    repaymentBaseUnits: remainingBaseUnits.toString(),
    balanceBaseUnits: balanceBaseUnits.toString(),
  };
}

export async function confirmOnChainRepayment(
  actor: AuthenticatedActor,
  loanId: string,
  repaymentId: string,
  transactionHash: Hex,
  dependencies: ConfirmOnChainRepaymentDependencies = {},
) {
  const confirmationStartedAt = Date.now();
  const database = dependencies.database ?? prisma;
  const configuredContract =
    dependencies.contractAddress ?? getConfiguredEscrowAddress();
  if (!configuredContract) throw configurationError();
  logTransactionLifecycle("repayment_submitted", {
    operationId: repaymentId,
    transactionHash,
    chainId: ARC_TESTNET_CHAIN_ID,
    contractAddress: configuredContract,
  });

  const pending = await database.loanRepayment.findFirst({
    where: {
      id: repaymentId,
      loanId,
      organizationId: actor.organizationId,
      loan: { borrowerMembership: { userId: actor.userId } },
    },
    select: {
      id: true,
      amountMinorUnits: true,
      status: true,
      paidAt: true,
      submissionTransactionHash: true,
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
          startedAt: true,
          borrowerMembershipId: true,
          lenderMembershipId: true,
          currency: true,
          principalAmountMinorUnits: true,
          feeAmountMinorUnits: true,
          repaymentDueAt: true,
          activatedAt: true,
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
    (pending.loan.status !== "ACTIVE" && pending.loan.status !== "OVERDUE") ||
    !pending.loan.chainLoanId ||
    pending.loan.contractAddress?.toLowerCase() !==
      configuredContract.toLowerCase() ||
    !pending.loan.lenderWalletAddress ||
    !pending.loan.borrowerWalletAddress ||
    pending.loan.repaymentBaseUnits === null
  ) {
    throw unavailableError();
  }

  const normalizedTransactionHash = transactionHash.toLowerCase();
  if (
    pending.submissionTransactionHash &&
    pending.submissionTransactionHash.toLowerCase() !==
      normalizedTransactionHash
  ) {
    throw new ApplicationError(
      "REPAYMENT_TRANSACTION_CONFLICT",
      "This repayment is already linked to another Arc transaction.",
      409,
    );
  }
  if (!pending.submissionTransactionHash) {
    const submitted = await database.loanRepayment.updateMany({
      where: {
        id: repaymentId,
        status: "PENDING",
        submissionTransactionHash: null,
      },
      data: { submissionTransactionHash: normalizedTransactionHash },
    });
    if (submitted.count !== 1) {
      const current = await database.loanRepayment.findUnique({
        where: { id: repaymentId },
        select: { status: true, submissionTransactionHash: true },
      });
      if (
        current?.status !== "PENDING" ||
        current.submissionTransactionHash?.toLowerCase() !==
          normalizedTransactionHash
      ) {
        throw new ApplicationError(
          "REPAYMENT_TRANSACTION_CONFLICT",
          "This repayment submission conflicted with another confirmation.",
          409,
        );
      }
    }
  }

  let receipt;
  try {
    receipt = await (
      dependencies.getTransactionReceipt ?? client.getTransactionReceipt
    )({ hash: transactionHash });
  } catch (error) {
    logTransactionLifecycle("transaction_pending", {
      operationId: repaymentId,
      transactionHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: configuredContract,
    });
    recordOperationalFailure("transaction_confirmation", {
      alertThreshold: operationalFailureAlertThreshold(),
      context: { operationId: repaymentId, eventType: "repayment" },
    });
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
    await database.loanRepayment.updateMany({
      where: { id: repaymentId, status: "PENDING" },
      data: { status: "FAILED" },
    });
    logTransactionLifecycle("repayment_reverted", {
      operationId: repaymentId,
      transactionHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: configuredContract,
    });
    recordOperationalFailure("transaction_confirmation", {
      alertThreshold: operationalFailureAlertThreshold(),
      context: { operationId: repaymentId, eventType: "repayment" },
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
    logTransactionLifecycle("transaction_unknown", {
      operationId: repaymentId,
      transactionHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: configuredContract,
    });
    throw new ApplicationError(
      "INVALID_REPAYMENT_CONFIRMATION",
      "The confirmed transaction does not match this loan repayment.",
      400,
    );
  }

  const chainLoan = await (dependencies.readLoan ?? readChainLoan)(
    configuredContract,
    event.loanId,
  );
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

  const onChainRepaidAt = new Date(Number(event.repaidAt) * 1_000);
  const repaidAt = resolveLifecycleRepaidAt(
    onChainRepaidAt,
    pending.loan.startedAt,
    pending.paidAt,
  );
  await database.$transaction(async (transaction) => {
    const updated = await transaction.loan.updateMany({
      where: { id: loanId, status: { in: ["ACTIVE", "OVERDUE"] } },
      data: {
        status: "REPAID",
        outstandingPrincipalMinorUnits: 0n,
        closedAt: repaidAt,
        onChainRepaidAt,
        repaymentTransactionHash: normalizedTransactionHash,
      },
    });
    if (updated.count !== 1) throw unavailableError();

    await transaction.loanRepayment.update({
      where: { id: repaymentId },
      data: { status: "COMPLETED", paidAt: repaidAt, completedAt: repaidAt },
    });
    let installment = await transaction.loanInstallment.findFirst({
      where: {
        organizationId: actor.organizationId,
        loanId,
        plan: { status: "ACTIVE" },
      },
      orderBy: { sequence: "asc" },
      select: { id: true },
    });
    if (!installment) {
      const totalRepaymentMinorUnits =
        pending.loan.principalAmountMinorUnits +
        pending.loan.feeAmountMinorUnits;
      const plan = await transaction.loanRepaymentPlan.create({
        data: {
          organizationId: actor.organizationId,
          loanId,
          version: 1,
          status: "ACTIVE",
          termMonths: 1,
          installmentCount: 1,
          totalRepaymentMinorUnits,
          currency: pending.loan.currency,
          borrowerConsentedAt:
            pending.loan.activatedAt ?? pending.loan.startedAt,
          effectiveAt: pending.loan.activatedAt ?? pending.loan.startedAt,
        },
      });
      installment = await transaction.loanInstallment.create({
        data: {
          organizationId: actor.organizationId,
          loanId,
          planId: plan.id,
          sequence: 1,
          amountMinorUnits: totalRepaymentMinorUnits,
          dueAt: pending.loan.repaymentDueAt,
        },
        select: { id: true },
      });
    }
    await transaction.repaymentAllocation.createMany({
      data: {
        organizationId: actor.organizationId,
        installmentId: installment.id,
        repaymentId,
        amountMinorUnits: pending.amountMinorUnits,
      },
      skipDuplicates: true,
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

  recordOperationalSuccess("transaction_confirmation");
  logTransactionLifecycle("repayment_confirmed", {
    operationId: repaymentId,
    transactionHash,
    chainId: ARC_TESTNET_CHAIN_ID,
    contractAddress: configuredContract,
    latencyMs: Date.now() - confirmationStartedAt,
  });
  return { loanId, status: "REPAID" as const };
}
