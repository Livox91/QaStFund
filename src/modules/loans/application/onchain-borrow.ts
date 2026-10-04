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
  arcTestnet,
} from "@/integrations/arc/arc-testnet";
import {
  employeeLendingEscrowAbi,
  getConfiguredEscrowAddress,
} from "@/integrations/arc/employee-lending-escrow";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { borrowRequestIdToAuthorizationId } from "@/modules/loans/domain/borrow-authorization";
import { calculateOnChainRepaymentBaseUnits } from "@/modules/loans/domain/onchain-borrow";
import { signBorrowAuthorization } from "@/modules/loans/infrastructure/borrow-authorization-signer";
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

const BORROW_AUTHORIZATION_TTL_SECONDS = 5n * 60n;

async function readChainOffer(
  contractAddress: `0x${string}`,
  chainOfferId: bigint,
) {
  return client.readContract({
    address: contractAddress,
    abi: employeeLendingEscrowAbi,
    functionName: "offers",
    args: [chainOfferId],
  });
}

async function readChainAuthorizationSigner(contractAddress: `0x${string}`) {
  return client.readContract({
    address: contractAddress,
    abi: employeeLendingEscrowAbi,
    functionName: "authorizationSigner",
  });
}

type PrepareOnChainBorrowDependencies = Readonly<{
  contractAddress?: `0x${string}`;
  database?: typeof prisma;
  now?: () => Date;
  readAuthorizationSigner?: typeof readChainAuthorizationSigner;
  readOffer?: typeof readChainOffer;
  signAuthorization?: typeof signBorrowAuthorization;
}>;

type ConfirmOnChainBorrowDependencies = Readonly<{
  contractAddress?: `0x${string}`;
  database?: typeof prisma;
  getTransactionReceipt?: typeof client.getTransactionReceipt;
  now?: () => Date;
}>;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function acceptanceIntentConflictError() {
  return new ApplicationError(
    "ACCEPTANCE_INTENT_CONFLICT",
    "Another borrowing attempt is already in progress for this offer.",
    409,
  );
}

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
  dependencies: PrepareOnChainBorrowDependencies = {},
) {
  const database = dependencies.database ?? prisma;
  const configuredContract =
    dependencies.contractAddress ?? getConfiguredEscrowAddress();
  if (!configuredContract) throw configurationError();

  const existing = await database.loan.findUnique({
    where: { borrowRequestId: requestId },
    select: {
      id: true,
      organizationId: true,
      borrowerMembership: { select: { userId: true } },
      lendingOfferId: true,
      chainOfferId: true,
      contractAddress: true,
      borrowerWalletAddress: true,
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
    if (
      ["ACTIVE", "OVERDUE", "REPAID", "DEFAULTED"].includes(existing.status)
    ) {
      return { state: "CONFIRMED" as const, loanId: existing.id };
    }
    if (existing.status !== "REQUESTED" && existing.status !== "CANCELLED") {
      throw unavailableError();
    }
  } else {
    const competing = await database.loan.findFirst({
      where: {
        organizationId: actor.organizationId,
        lendingOfferId: offerId,
        status: "REQUESTED",
      },
      select: { borrowRequestId: true },
    });
    if (competing && competing.borrowRequestId !== requestId) {
      throw acceptanceIntentConflictError();
    }
  }

  const now = dependencies.now?.() ?? new Date();
  const context = await database.$transaction(async (transaction) => {
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
  if (
    existing?.borrowerWalletAddress &&
    existing.borrowerWalletAddress.toLowerCase() !==
      borrowerWalletAddress.toLowerCase()
  ) {
    throw new ApplicationError(
      "BORROW_REQUEST_CONFLICT",
      "This borrowing request has already been used.",
      409,
    );
  }

  const chainOffer = await (dependencies.readOffer ?? readChainOffer)(
    configuredContract,
    BigInt(chainOfferId),
  );
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

  const authorizationExpiry =
    BigInt(Math.floor(now.getTime() / 1_000)) +
    BORROW_AUTHORIZATION_TTL_SECONDS;
  const authorization = await (
    dependencies.signAuthorization ?? signBorrowAuthorization
  )(
    {
      offerId: BigInt(chainOfferId),
      borrower: getAddress(borrowerWalletAddress),
      expiry: authorizationExpiry,
      authorizationId: borrowRequestIdToAuthorizationId(requestId),
    },
    configuredContract,
  );
  const configuredAuthorizationSigner = await (
    dependencies.readAuthorizationSigner ?? readChainAuthorizationSigner
  )(configuredContract);
  if (
    configuredAuthorizationSigner.toLowerCase() !==
    authorization.signerAddress.toLowerCase()
  ) {
    throw new ApplicationError(
      "BORROW_AUTHORIZER_MISMATCH",
      "Borrowing authorization is not configured for this contract.",
      503,
    );
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

  let loan: { id: string };
  try {
    if (existing?.status === "CANCELLED") {
      const revived = await database.loan.updateMany({
        where: { id: existing.id, status: "CANCELLED" },
        data: {
          status: "REQUESTED",
          closedAt: null,
          requestedAt: now,
          startedAt: now,
          repaymentDueAt: estimatedDueAt,
        },
      });
      if (revived.count === 1) {
        loan = existing;
      } else {
        const current = await database.loan.findUnique({
          where: { borrowRequestId: requestId },
          select: { id: true, status: true },
        });
        if (current?.status !== "REQUESTED") {
          throw acceptanceIntentConflictError();
        }
        loan = current;
      }
    } else if (existing) {
      loan = existing;
    } else {
      loan = await database.loan.create({
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
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const sameRequest = await database.loan.findUnique({
      where: { borrowRequestId: requestId },
      select: {
        id: true,
        organizationId: true,
        lendingOfferId: true,
        status: true,
        borrowerMembership: { select: { userId: true } },
      },
    });
    if (
      sameRequest?.organizationId === actor.organizationId &&
      sameRequest.borrowerMembership.userId === actor.userId &&
      sameRequest.lendingOfferId === offerId
    ) {
      if (
        ["ACTIVE", "OVERDUE", "REPAID", "DEFAULTED"].includes(
          sameRequest.status,
        )
      ) {
        return { state: "CONFIRMED" as const, loanId: sameRequest.id };
      }
      if (sameRequest.status === "REQUESTED") {
        loan = sameRequest;
      } else {
        throw acceptanceIntentConflictError();
      }
    } else {
      throw acceptanceIntentConflictError();
    }
  }

  return {
    state: "PENDING" as const,
    loanId: loan.id,
    contractAddress: configuredContract,
    chainOfferId,
    authorizationExpiry: authorization.expiry.toString(),
    authorizationId: authorization.authorizationId,
    authorizationSignature: authorization.signature,
  };
}

export async function confirmOnChainBorrow(
  actor: AuthenticatedActor,
  loanId: string,
  transactionHash: Hex,
  dependencies: ConfirmOnChainBorrowDependencies = {},
) {
  const confirmationStartedAt = Date.now();
  const database = dependencies.database ?? prisma;
  const configuredContract =
    dependencies.contractAddress ?? getConfiguredEscrowAddress();
  if (!configuredContract) throw configurationError();
  logTransactionLifecycle("acceptance_submitted", {
    operationId: loanId,
    transactionHash,
    chainId: ARC_TESTNET_CHAIN_ID,
    contractAddress: configuredContract,
  });
  const pending = await database.loan.findFirst({
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
    receipt = await (
      dependencies.getTransactionReceipt ?? client.getTransactionReceipt
    )({ hash: transactionHash });
  } catch (error) {
    logTransactionLifecycle("transaction_pending", {
      operationId: loanId,
      transactionHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: configuredContract,
    });
    recordOperationalFailure("transaction_confirmation", {
      alertThreshold: operationalFailureAlertThreshold(),
      context: { operationId: loanId, eventType: "acceptance" },
    });
    logger.error("Arc loan receipt is not available yet", error, { loanId });
    throw new ApplicationError(
      "LOAN_CONFIRMATION_PENDING",
      "The transfer is still being confirmed. Try again shortly.",
      409,
    );
  }
  if (receipt.status !== "success") {
    await database.loan.updateMany({
      where: { id: pending.id, status: "REQUESTED" },
      data: {
        status: "CANCELLED",
        closedAt: dependencies.now?.() ?? new Date(),
      },
    });
    logTransactionLifecycle("acceptance_reverted", {
      operationId: loanId,
      transactionHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: configuredContract,
    });
    recordOperationalFailure("transaction_confirmation", {
      alertThreshold: operationalFailureAlertThreshold(),
      context: { operationId: loanId, eventType: "acceptance" },
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
    logTransactionLifecycle("transaction_unknown", {
      operationId: loanId,
      transactionHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: configuredContract,
    });
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
  await database.$transaction(async (transaction) => {
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

  recordOperationalSuccess("transaction_confirmation");
  logTransactionLifecycle("acceptance_confirmed", {
    operationId: loanId,
    transactionHash,
    chainId: ARC_TESTNET_CHAIN_ID,
    contractAddress: configuredContract,
    latencyMs: Date.now() - confirmationStartedAt,
  });
  return { loanId: pending.id, status: "ACTIVE" as const };
}
