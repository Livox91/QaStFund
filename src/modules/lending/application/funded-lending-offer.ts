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
  fundingRequestIdToBytes32,
  getConfiguredEscrowAddress,
} from "@/integrations/arc/employee-lending-escrow";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { matchesFundedOfferEvent } from "@/modules/lending/domain/lending-offer";
import { ensureOrganizationPolicy } from "@/modules/policies/infrastructure/policy-data";
import { validateOfferAgainstPolicy } from "@/modules/policies/domain/lending-policy";
import { ApplicationError } from "@/shared/errors/application-error";

export type FundedOfferTerms = Readonly<{
  requestId: string;
  principalBaseUnits: bigint;
  amountMinorUnits: bigint;
  feeRateBasisPoints: number;
  durationDays: number;
  durationSeconds: number;
}>;

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC_URL),
});

function configurationError(): ApplicationError {
  return new ApplicationError(
    "LENDING_ESCROW_NOT_CONFIGURED",
    "Lending escrow is not configured for Arc Testnet.",
    503,
  );
}

function invalidOffer(message = "The lending offer could not be funded.") {
  return new ApplicationError("INVALID_FUNDED_OFFER", message, 400);
}

export async function prepareFundedLendingOffer(
  actor: AuthenticatedActor,
  terms: FundedOfferTerms,
) {
  const contractAddress = getConfiguredEscrowAddress();
  if (!contractAddress) throw configurationError();

  const existing = await prisma.lendingOffer.findUnique({
    where: { fundingRequestId: terms.requestId },
    select: {
      id: true,
      organizationId: true,
      lenderMembership: { select: { userId: true } },
      principalBaseUnits: true,
      feeRateBasisPoints: true,
      durationDays: true,
      fundingStatus: true,
    },
  });
  if (existing) {
    if (
      existing.organizationId !== actor.organizationId ||
      existing.lenderMembership.userId !== actor.userId ||
      existing.principalBaseUnits !== terms.principalBaseUnits ||
      existing.feeRateBasisPoints !== terms.feeRateBasisPoints ||
      existing.durationDays !== terms.durationDays
    ) {
      throw new ApplicationError(
        "FUNDING_REQUEST_CONFLICT",
        "This funding request has already been used.",
        409,
      );
    }
    return toIntent(existing.id, terms, contractAddress);
  }

  const membership = await prisma.organizationMembership.findUnique({
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
      canLend: true,
      organization: { select: { currency: true } },
    },
  });
  if (
    !membership?.isActive ||
    membership.employmentStatus !== "ACTIVE" ||
    membership.role !== "EMPLOYEE"
  ) {
    throw new ApplicationError(
      "EMPLOYEE_NOT_ELIGIBLE",
      "An active employee membership is required.",
      403,
    );
  }
  if (membership.organization.currency !== "USD") {
    throw invalidOffer("This organization is not configured for USDC offers.");
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
    wallet.organizationId !== actor.organizationId
  ) {
    throw new ApplicationError(
      "ARC_WALLET_NOT_READY",
      "Your Arc wallet must be ready before creating a lending offer.",
      409,
    );
  }

  const policy = await prisma.$transaction((transaction) =>
    ensureOrganizationPolicy(transaction, actor.organizationId),
  );
  const violation = validateOfferAgainstPolicy(policy, membership, terms);
  if (violation) {
    throw invalidOffer(`The offer violates organization policy: ${violation}.`);
  }

  const balance = await client.readContract({
    address: ARC_USDC_ADDRESS,
    abi: erc20UsdcAbi,
    functionName: "balanceOf",
    args: [getAddress(wallet.address)],
  });
  if (balance < terms.principalBaseUnits) {
    throw new ApplicationError(
      "INSUFFICIENT_USDC_BALANCE",
      "Your Arc wallet does not have enough USDC for this offer.",
      409,
    );
  }

  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 30);
  const offer = await prisma.lendingOffer.create({
    data: {
      organizationId: actor.organizationId,
      lenderMembershipId: membership.id,
      amountMinorUnits: terms.amountMinorUnits,
      availableAmountMinorUnits: terms.amountMinorUnits,
      minimumLoanAmountMinorUnits: terms.amountMinorUnits,
      maximumLoanAmountMinorUnits: terms.amountMinorUnits,
      currency: membership.organization.currency,
      durationDays: terms.durationDays,
      feeRateBasisPoints: terms.feeRateBasisPoints,
      expiresAt,
      status: "PAUSED",
      fundingStatus: "PENDING",
      fundingRequestId: terms.requestId,
      lenderWalletAddress: wallet.address.toLowerCase(),
      principalBaseUnits: terms.principalBaseUnits,
      contractAddress: contractAddress.toLowerCase(),
    },
    select: { id: true },
  });
  return toIntent(offer.id, terms, contractAddress);
}

function toIntent(
  offerId: string,
  terms: FundedOfferTerms,
  contractAddress: `0x${string}`,
) {
  return {
    offerId,
    contractAddress,
    usdcAddress: ARC_USDC_ADDRESS,
    principalBaseUnits: terms.principalBaseUnits.toString(),
    feeRateBasisPoints: terms.feeRateBasisPoints,
    durationSeconds: terms.durationSeconds,
    requestId: fundingRequestIdToBytes32(terms.requestId),
  };
}

export async function confirmFundedLendingOffer(
  actor: AuthenticatedActor,
  offerId: string,
  transactionHash: Hex,
) {
  const confirmationStartedAt = Date.now();
  const contractAddress = getConfiguredEscrowAddress();
  if (!contractAddress) throw configurationError();
  logTransactionLifecycle("offer_submitted", {
    operationId: offerId,
    transactionHash,
    chainId: ARC_TESTNET_CHAIN_ID,
    contractAddress,
  });
  const offer = await prisma.lendingOffer.findFirst({
    where: {
      id: offerId,
      organizationId: actor.organizationId,
      lenderMembership: { userId: actor.userId },
    },
    select: {
      id: true,
      fundingStatus: true,
      fundingRequestId: true,
      lenderWalletAddress: true,
      principalBaseUnits: true,
      feeRateBasisPoints: true,
      durationDays: true,
      fundingTransactionHash: true,
    },
  });
  if (!offer)
    throw new ApplicationError("OFFER_NOT_FOUND", "Offer not found.", 404);
  if (offer.fundingStatus === "FUNDED") {
    if (
      offer.fundingTransactionHash?.toLowerCase() !==
      transactionHash.toLowerCase()
    ) {
      throw new ApplicationError(
        "FUNDING_REQUEST_CONFLICT",
        "Offer is already funded.",
        409,
      );
    }
    return { offerId: offer.id, status: "FUNDED" as const };
  }
  if (
    offer.fundingStatus !== "PENDING" ||
    !offer.fundingRequestId ||
    !offer.lenderWalletAddress ||
    offer.principalBaseUnits === null
  ) {
    throw invalidOffer("This offer is not awaiting funding confirmation.");
  }

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: transactionHash });
  } catch (error) {
    logTransactionLifecycle("transaction_pending", {
      operationId: offerId,
      transactionHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress,
    });
    recordOperationalFailure("transaction_confirmation", {
      alertThreshold: operationalFailureAlertThreshold(),
      context: { operationId: offerId, eventType: "offer" },
    });
    logger.error("Arc funding receipt is not available yet", error, {
      offerId,
    });
    throw new ApplicationError(
      "FUNDING_CONFIRMATION_PENDING",
      "The Arc transaction is not confirmed yet. Try again shortly.",
      409,
    );
  }
  if (receipt.status !== "success") {
    await prisma.lendingOffer.updateMany({
      where: { id: offer.id, fundingStatus: "PENDING" },
      data: { fundingStatus: "FAILED", status: "CLOSED" },
    });
    logTransactionLifecycle("offer_reverted", {
      operationId: offerId,
      transactionHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress,
    });
    recordOperationalFailure("transaction_confirmation", {
      alertThreshold: operationalFailureAlertThreshold(),
      context: { operationId: offerId, eventType: "offer" },
    });
    throw invalidOffer("The Arc funding transaction failed.");
  }

  const expectedRequestId = fundingRequestIdToBytes32(offer.fundingRequestId);
  let chainOfferId: bigint | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: employeeLendingEscrowAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        decoded.eventName === "OfferCreated" &&
        matchesFundedOfferEvent(
          {
            lender: decoded.args.lender,
            principal: decoded.args.principal,
            interestBasisPoints: decoded.args.interestBps,
            durationSeconds: decoded.args.duration,
            requestId: decoded.args.requestId,
          },
          {
            lenderWalletAddress: offer.lenderWalletAddress,
            principalBaseUnits: offer.principalBaseUnits,
            feeRateBasisPoints: offer.feeRateBasisPoints,
            durationDays: offer.durationDays,
            requestId: expectedRequestId,
          },
        )
      ) {
        chainOfferId = decoded.args.offerId;
        break;
      }
    } catch {
      // A receipt can contain unrelated logs from USDC and account abstraction.
    }
  }
  if (chainOfferId === null) {
    logTransactionLifecycle("transaction_unknown", {
      operationId: offerId,
      transactionHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress,
    });
    throw invalidOffer(
      "The transaction does not contain this offer's funding event.",
    );
  }

  const updated = await prisma.lendingOffer.updateMany({
    where: { id: offer.id, fundingStatus: "PENDING" },
    data: {
      fundingStatus: "FUNDED",
      status: "ACTIVE",
      chainOfferId: chainOfferId.toString(),
      fundingTransactionHash: transactionHash.toLowerCase(),
      fundedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    throw new ApplicationError(
      "FUNDING_REQUEST_CONFLICT",
      "Offer confirmation conflicted.",
      409,
    );
  }
  recordOperationalSuccess("transaction_confirmation");
  logTransactionLifecycle("offer_confirmed", {
    operationId: offerId,
    transactionHash,
    chainId: ARC_TESTNET_CHAIN_ID,
    contractAddress,
    latencyMs: Date.now() - confirmationStartedAt,
  });
  return { offerId: offer.id, status: "FUNDED" as const };
}
