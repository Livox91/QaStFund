import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { fundingRequestIdToBytes32 } from "@/integrations/arc/employee-lending-escrow";
import type { ReconciliationRepository } from "@/modules/blockchain-reconciliation/application/ports";
import type {
  ReconciliationEvent,
  StoredReconciliationEvent,
} from "@/modules/blockchain-reconciliation/domain/blockchain-event";
import { USDC_BASE_UNITS_PER_CENT } from "@/shared/money/usdc";

function eventKey(event: {
  transactionHash: string;
  logIndex: number;
}): string {
  return `${event.transactionHash.toLowerCase()}:${event.logIndex}`;
}

function serializeEvent(event: ReconciliationEvent): Prisma.InputJsonValue {
  return {
    ...event.payload,
    blockTimestamp: event.blockTimestamp.toISOString(),
  };
}

function deserializeEvent(row: {
  id: string;
  name: "OFFER_CREATED" | "LOAN_STARTED" | "LOAN_REPAID";
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  payload: Prisma.JsonValue;
}): StoredReconciliationEvent {
  const payload = row.payload as Record<string, string>;
  const base = {
    id: row.id,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash as `0x${string}`,
    transactionHash: row.transactionHash as `0x${string}`,
    logIndex: row.logIndex,
    blockTimestamp: new Date(payload.blockTimestamp),
  };
  if (row.name === "OFFER_CREATED") {
    return {
      ...base,
      name: row.name,
      payload: {
        offerId: payload.offerId,
        lender: payload.lender,
        principal: payload.principal,
        interestBps: payload.interestBps,
        duration: payload.duration,
        requestId: payload.requestId,
      },
    };
  }
  if (row.name === "LOAN_STARTED") {
    return {
      ...base,
      name: row.name,
      payload: {
        loanId: payload.loanId,
        offerId: payload.offerId,
        lender: payload.lender,
        borrower: payload.borrower,
        principal: payload.principal,
        repaymentAmount: payload.repaymentAmount,
        startTime: payload.startTime,
        dueTime: payload.dueTime,
      },
    };
  }
  return {
    ...base,
    name: row.name,
    payload: {
      loanId: payload.loanId,
      borrower: payload.borrower,
      lender: payload.lender,
      amount: payload.amount,
      repaidAt: payload.repaidAt,
    },
  };
}

function minorUnits(value: bigint): bigint {
  return (value + USDC_BASE_UNITS_PER_CENT - 1n) / USDC_BASE_UNITS_PER_CENT;
}

function termsMatchOffer(
  offer: {
    lenderWalletAddress: string | null;
    principalBaseUnits: bigint | null;
    feeRateBasisPoints: number;
    durationDays: number;
    fundingRequestId: string | null;
  },
  event: Extract<StoredReconciliationEvent, { name: "OFFER_CREATED" }>,
) {
  return (
    offer.fundingRequestId !== null &&
    fundingRequestIdToBytes32(offer.fundingRequestId).toLowerCase() ===
      event.payload.requestId &&
    offer.lenderWalletAddress?.toLowerCase() === event.payload.lender &&
    offer.principalBaseUnits === BigInt(event.payload.principal) &&
    offer.feeRateBasisPoints === Number(event.payload.interestBps) &&
    BigInt(offer.durationDays * 86_400) === BigInt(event.payload.duration)
  );
}

function termsMatchLoan(
  loan: {
    chainOfferId: string | null;
    lenderWalletAddress: string | null;
    borrowerWalletAddress: string | null;
    principalBaseUnits: bigint | null;
    repaymentBaseUnits: bigint | null;
    durationDays: number;
  },
  event: Extract<StoredReconciliationEvent, { name: "LOAN_STARTED" }>,
) {
  return (
    loan.chainOfferId === event.payload.offerId &&
    loan.lenderWalletAddress?.toLowerCase() === event.payload.lender &&
    loan.borrowerWalletAddress?.toLowerCase() === event.payload.borrower &&
    loan.principalBaseUnits === BigInt(event.payload.principal) &&
    loan.repaymentBaseUnits === BigInt(event.payload.repaymentAmount) &&
    BigInt(event.payload.dueTime) - BigInt(event.payload.startTime) ===
      BigInt(loan.durationDays * 86_400)
  );
}

async function resolveEvent(
  transaction: Prisma.TransactionClient,
  eventId: string,
  result:
    | { kind: "APPLIED"; organizationId: string; recordId: string }
    | { kind: "UNMATCHED"; code: string; note: string }
    | { kind: "CONFLICT"; code: string; note: string },
  now: Date,
) {
  await transaction.blockchainEvent.update({
    where: { id: eventId },
    data:
      result.kind === "APPLIED"
        ? {
            status: "APPLIED",
            organizationId: result.organizationId,
            matchedRecordId: result.recordId,
            investigationCode: null,
            investigationNote: null,
            processedAt: now,
          }
        : {
            status: result.kind,
            investigationCode: result.code,
            investigationNote: result.note,
            processedAt: now,
          },
  });
  return result;
}

async function applyOfferCreated(
  transaction: Prisma.TransactionClient,
  event: Extract<StoredReconciliationEvent, { name: "OFFER_CREATED" }>,
  contractAddress: string,
  now: Date,
) {
  const candidates = await transaction.lendingOffer.findMany({
    where: {
      contractAddress,
      fundingRequestId: { not: null },
      OR: [
        { fundingStatus: "PENDING" },
        { chainOfferId: event.payload.offerId },
        { fundingTransactionHash: event.transactionHash.toLowerCase() },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      fundingStatus: true,
      fundingRequestId: true,
      lenderWalletAddress: true,
      principalBaseUnits: true,
      feeRateBasisPoints: true,
      durationDays: true,
      chainOfferId: true,
      fundingTransactionHash: true,
    },
  });
  const matches = candidates.filter((offer) => termsMatchOffer(offer, event));
  if (matches.length === 0) {
    return resolveEvent(
      transaction,
      event.id,
      {
        kind: "UNMATCHED",
        code: "FUNDING_INTENT_NOT_FOUND",
        note: "No pending funding intent matches the finalized OfferCreated event.",
      },
      now,
    );
  }
  if (matches.length !== 1) {
    return resolveEvent(
      transaction,
      event.id,
      {
        kind: "CONFLICT",
        code: "AMBIGUOUS_FUNDING_INTENT",
        note: "Multiple funding records match the finalized OfferCreated event.",
      },
      now,
    );
  }
  const offer = matches[0];
  if (offer.fundingStatus === "FUNDED") {
    if (
      offer.chainOfferId !== event.payload.offerId ||
      offer.fundingTransactionHash?.toLowerCase() !== event.transactionHash
    ) {
      return resolveEvent(
        transaction,
        event.id,
        {
          kind: "CONFLICT",
          code: "FINALIZED_FUNDING_CONFLICT",
          note: "The funded offer references a different chain operation.",
        },
        now,
      );
    }
  } else {
    const updated = await transaction.lendingOffer.updateMany({
      where: { id: offer.id, fundingStatus: "PENDING" },
      data: {
        fundingStatus: "FUNDED",
        status: "ACTIVE",
        chainOfferId: event.payload.offerId,
        fundingTransactionHash: event.transactionHash.toLowerCase(),
        fundedAt: event.blockTimestamp,
      },
    });
    if (updated.count !== 1) {
      return resolveEvent(
        transaction,
        event.id,
        {
          kind: "CONFLICT",
          code: "FUNDING_TRANSITION_CONFLICT",
          note: "The funding intent changed while reconciliation was applying it.",
        },
        now,
      );
    }
  }
  return resolveEvent(
    transaction,
    event.id,
    {
      kind: "APPLIED",
      organizationId: offer.organizationId,
      recordId: offer.id,
    },
    now,
  );
}

async function applyLoanStarted(
  transaction: Prisma.TransactionClient,
  event: Extract<StoredReconciliationEvent, { name: "LOAN_STARTED" }>,
  contractAddress: string,
  now: Date,
) {
  const candidates = await transaction.loan.findMany({
    where: {
      contractAddress,
      OR: [
        { status: "REQUESTED", chainOfferId: event.payload.offerId },
        { chainLoanId: event.payload.loanId },
        { acceptanceTransactionHash: event.transactionHash.toLowerCase() },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      lendingOfferId: true,
      chainLoanId: true,
      chainOfferId: true,
      lenderWalletAddress: true,
      borrowerWalletAddress: true,
      principalBaseUnits: true,
      repaymentBaseUnits: true,
      durationDays: true,
      acceptanceTransactionHash: true,
    },
  });
  const matches = candidates.filter((loan) => termsMatchLoan(loan, event));
  if (matches.length === 0) {
    return resolveEvent(
      transaction,
      event.id,
      {
        kind: "UNMATCHED",
        code: "ACCEPTANCE_INTENT_NOT_FOUND",
        note: "No pending acceptance intent matches the finalized LoanStarted event.",
      },
      now,
    );
  }
  if (matches.length !== 1) {
    return resolveEvent(
      transaction,
      event.id,
      {
        kind: "CONFLICT",
        code: "AMBIGUOUS_ACCEPTANCE_INTENT",
        note: "Multiple loan records match the finalized LoanStarted event.",
      },
      now,
    );
  }
  const loan = matches[0];
  if (loan.status !== "REQUESTED") {
    if (
      loan.chainLoanId !== event.payload.loanId ||
      loan.acceptanceTransactionHash?.toLowerCase() !== event.transactionHash
    ) {
      return resolveEvent(
        transaction,
        event.id,
        {
          kind: "CONFLICT",
          code: "FINALIZED_ACCEPTANCE_CONFLICT",
          note: "The loan references a different finalized acceptance.",
        },
        now,
      );
    }
  } else {
    const startedAt = new Date(Number(event.payload.startTime) * 1_000);
    const dueAt = new Date(Number(event.payload.dueTime) * 1_000);
    const updated = await transaction.loan.updateMany({
      where: { id: loan.id, status: "REQUESTED" },
      data: {
        status: "ACTIVE",
        chainLoanId: event.payload.loanId,
        acceptanceTransactionHash: event.transactionHash.toLowerCase(),
        approvedAt: startedAt,
        activatedAt: startedAt,
        startedAt,
        repaymentDueAt: dueAt,
        onChainStartedAt: startedAt,
        onChainDueAt: dueAt,
      },
    });
    if (updated.count !== 1) {
      return resolveEvent(
        transaction,
        event.id,
        {
          kind: "CONFLICT",
          code: "ACCEPTANCE_TRANSITION_CONFLICT",
          note: "The acceptance intent changed while reconciliation was applying it.",
        },
        now,
      );
    }
    if (loan.lendingOfferId) {
      await transaction.lendingOffer.updateMany({
        where: {
          id: loan.lendingOfferId,
          organizationId: loan.organizationId,
          status: "ACTIVE",
          fundingStatus: "FUNDED",
        },
        data: { status: "EXHAUSTED", availableAmountMinorUnits: 0n },
      });
    }
    await transaction.auditEvent.create({
      data: {
        organizationId: loan.organizationId,
        loanId: loan.id,
        lendingOfferId: loan.lendingOfferId,
        amountMinorUnits: minorUnits(BigInt(event.payload.principal)),
        currency: "USD",
        type: "LOAN_ACTIVATED",
        title: "Escrow released and loan activated",
        occurredAt: startedAt,
        metadata: {
          chainLoanId: event.payload.loanId,
          transactionHash: event.transactionHash.toLowerCase(),
          reconciled: true,
        },
      },
    });
  }
  return resolveEvent(
    transaction,
    event.id,
    { kind: "APPLIED", organizationId: loan.organizationId, recordId: loan.id },
    now,
  );
}

async function applyLoanRepaid(
  transaction: Prisma.TransactionClient,
  event: Extract<StoredReconciliationEvent, { name: "LOAN_REPAID" }>,
  contractAddress: string,
  now: Date,
) {
  const loan = await transaction.loan.findUnique({
    where: {
      contractAddress_chainLoanId: {
        contractAddress,
        chainLoanId: event.payload.loanId,
      },
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      lenderWalletAddress: true,
      borrowerWalletAddress: true,
      repaymentBaseUnits: true,
      repaymentTransactionHash: true,
      borrowerMembershipId: true,
      lenderMembershipId: true,
      currency: true,
    },
  });
  if (!loan) {
    return resolveEvent(
      transaction,
      event.id,
      {
        kind: "UNMATCHED",
        code: "CHAIN_LOAN_NOT_FOUND",
        note: "No application loan matches the finalized LoanRepaid event.",
      },
      now,
    );
  }
  if (
    loan.lenderWalletAddress?.toLowerCase() !== event.payload.lender ||
    loan.borrowerWalletAddress?.toLowerCase() !== event.payload.borrower ||
    loan.repaymentBaseUnits !== BigInt(event.payload.amount)
  ) {
    return resolveEvent(
      transaction,
      event.id,
      {
        kind: "CONFLICT",
        code: "REPAYMENT_TERMS_MISMATCH",
        note: "The finalized repayment event does not match the application loan.",
      },
      now,
    );
  }
  const repayment = await transaction.loanRepayment.findFirst({
    where: {
      organizationId: loan.organizationId,
      loanId: loan.id,
      status: loan.status === "REPAID" ? "COMPLETED" : "PENDING",
    },
    select: { id: true },
  });
  if (!repayment) {
    return resolveEvent(
      transaction,
      event.id,
      {
        kind: "UNMATCHED",
        code: "REPAYMENT_INTENT_NOT_FOUND",
        note: "No pending repayment intent matches the finalized LoanRepaid event.",
      },
      now,
    );
  }
  if (loan.status === "REPAID") {
    if (
      loan.repaymentTransactionHash?.toLowerCase() !== event.transactionHash
    ) {
      return resolveEvent(
        transaction,
        event.id,
        {
          kind: "CONFLICT",
          code: "FINALIZED_REPAYMENT_CONFLICT",
          note: "The repaid loan references a different finalized transaction.",
        },
        now,
      );
    }
  } else if (loan.status === "ACTIVE" || loan.status === "OVERDUE") {
    const repaidAt = new Date(Number(event.payload.repaidAt) * 1_000);
    const updated = await transaction.loan.updateMany({
      where: { id: loan.id, status: { in: ["ACTIVE", "OVERDUE"] } },
      data: {
        status: "REPAID",
        outstandingPrincipalMinorUnits: 0n,
        closedAt: repaidAt,
        onChainRepaidAt: repaidAt,
        repaymentTransactionHash: event.transactionHash.toLowerCase(),
      },
    });
    if (updated.count !== 1) {
      return resolveEvent(
        transaction,
        event.id,
        {
          kind: "CONFLICT",
          code: "REPAYMENT_TRANSITION_CONFLICT",
          note: "The repayment intent changed while reconciliation was applying it.",
        },
        now,
      );
    }
    await transaction.loanRepayment.updateMany({
      where: { id: repayment.id, status: "PENDING" },
      data: { status: "COMPLETED", paidAt: repaidAt, completedAt: repaidAt },
    });
    await transaction.auditEvent.createMany({
      data: [
        {
          organizationId: loan.organizationId,
          loanId: loan.id,
          repaymentId: repayment.id,
          actorMembershipId: loan.borrowerMembershipId,
          targetMembershipId: loan.lenderMembershipId,
          amountMinorUnits: minorUnits(BigInt(event.payload.amount)),
          currency: loan.currency,
          type: "REPAYMENT_COMPLETED",
          title: "On-chain repayment completed",
          occurredAt: repaidAt,
          metadata: {
            chainLoanId: event.payload.loanId,
            transactionHash: event.transactionHash.toLowerCase(),
            reconciled: true,
          },
        },
        {
          organizationId: loan.organizationId,
          loanId: loan.id,
          repaymentId: repayment.id,
          actorMembershipId: loan.borrowerMembershipId,
          targetMembershipId: loan.lenderMembershipId,
          amountMinorUnits: minorUnits(BigInt(event.payload.amount)),
          currency: loan.currency,
          type: "LOAN_REPAID",
          title: "Loan repaid in full",
          occurredAt: repaidAt,
          metadata: {
            chainLoanId: event.payload.loanId,
            transactionHash: event.transactionHash.toLowerCase(),
            reconciled: true,
          },
        },
      ],
    });
  } else {
    return resolveEvent(
      transaction,
      event.id,
      {
        kind: "CONFLICT",
        code: "INVALID_REPAYMENT_STATE",
        note: "The application loan cannot transition to repaid from its current state.",
      },
      now,
    );
  }
  return resolveEvent(
    transaction,
    event.id,
    {
      kind: "APPLIED",
      organizationId: loan.organizationId,
      recordId: repayment.id,
    },
    now,
  );
}

export const prismaReconciliationRepository: ReconciliationRepository = {
  async acquireLease(input) {
    const contractAddress = input.contractAddress.toLowerCase();
    try {
      await prisma.blockchainReconciliationCursor.upsert({
        where: {
          chainId_contractAddress: {
            chainId: input.chainId,
            contractAddress,
          },
        },
        create: {
          chainId: input.chainId,
          contractAddress,
          nextBlock: input.startBlock,
          finalizedThrough: input.startBlock > 0n ? input.startBlock - 1n : 0n,
        },
        update: {},
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
    }
    const claimed = await prisma.blockchainReconciliationCursor.updateMany({
      where: {
        chainId: input.chainId,
        contractAddress,
        OR: [
          { leaseOwner: null },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: input.now } },
        ],
      },
      data: {
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseExpiresAt,
      },
    });
    if (claimed.count !== 1) return null;
    return prisma.blockchainReconciliationCursor.findUniqueOrThrow({
      where: {
        chainId_contractAddress: {
          chainId: input.chainId,
          contractAddress,
        },
      },
      select: { nextBlock: true },
    });
  },

  async recordRange(input) {
    const contractAddress = input.contractAddress.toLowerCase();
    await prisma.$transaction(async (transaction) => {
      const cursor =
        await transaction.blockchainReconciliationCursor.findUnique({
          where: {
            chainId_contractAddress: {
              chainId: input.chainId,
              contractAddress,
            },
          },
          select: { nextBlock: true, finalizedThrough: true, leaseOwner: true },
        });
      if (cursor?.leaseOwner !== input.leaseOwner) {
        throw new Error("Arc reconciliation lease was lost");
      }
      const existing = await transaction.blockchainEvent.findMany({
        where: {
          chainId: input.chainId,
          contractAddress,
          blockNumber: { gte: input.fromBlock, lte: input.toBlock },
          status: { not: "REORGED" },
        },
      });
      const canonicalKeys = new Set(input.events.map(eventKey));
      for (const stale of existing.filter(
        (event) => !canonicalKeys.has(eventKey(event)),
      )) {
        const finalized = stale.isFinalized || stale.status === "APPLIED";
        await transaction.blockchainEvent.update({
          where: { id: stale.id },
          data: finalized
            ? {
                status: "CONFLICT",
                investigationCode: "FINALIZED_EVENT_MISSING",
                investigationNote:
                  "A previously finalized event is absent from the canonical recheck window.",
              }
            : {
                status: "REORGED",
                isFinalized: false,
                finalizedAt: null,
                investigationCode: "PROVISIONAL_EVENT_REORGED",
                investigationNote:
                  "The provisional event disappeared from the canonical chain.",
              },
        });
      }

      for (const event of input.events) {
        const key = {
          chainId: input.chainId,
          contractAddress,
          transactionHash: event.transactionHash.toLowerCase(),
          logIndex: event.logIndex,
        };
        const prior = await transaction.blockchainEvent.findUnique({
          where: { chainId_contractAddress_transactionHash_logIndex: key },
        });
        if (
          prior &&
          prior.blockHash !== event.blockHash.toLowerCase() &&
          (prior.isFinalized || prior.status === "APPLIED")
        ) {
          await transaction.blockchainEvent.update({
            where: { id: prior.id },
            data: {
              status: "CONFLICT",
              investigationCode: "FINALIZED_EVENT_CHANGED",
              investigationNote:
                "A finalized event changed block identity during a canonical recheck.",
            },
          });
          continue;
        }
        await transaction.blockchainEvent.upsert({
          where: { chainId_contractAddress_transactionHash_logIndex: key },
          create: {
            ...key,
            blockNumber: event.blockNumber,
            blockHash: event.blockHash.toLowerCase(),
            name: event.name,
            payload: serializeEvent(event),
            observedAt: input.now,
          },
          update: {
            blockNumber: event.blockNumber,
            blockHash: event.blockHash.toLowerCase(),
            name: event.name,
            payload: serializeEvent(event),
            observedAt: input.now,
            ...(prior?.status === "REORGED"
              ? {
                  status: "PROVISIONAL" as const,
                  investigationCode: null,
                  investigationNote: null,
                }
              : {}),
          },
        });
      }
      await transaction.blockchainEvent.updateMany({
        where: {
          chainId: input.chainId,
          contractAddress,
          blockNumber: { lte: input.finalizedThrough },
          isFinalized: false,
          status: { in: ["PROVISIONAL", "UNMATCHED"] },
        },
        data: { isFinalized: true, finalizedAt: input.now },
      });
      await transaction.blockchainReconciliationCursor.update({
        where: {
          chainId_contractAddress: {
            chainId: input.chainId,
            contractAddress,
          },
        },
        data: {
          nextBlock:
            cursor.nextBlock > input.toBlock + 1n
              ? cursor.nextBlock
              : input.toBlock + 1n,
          finalizedThrough:
            cursor.finalizedThrough > input.finalizedThrough
              ? cursor.finalizedThrough
              : input.finalizedThrough,
        },
      });
    });
  },

  async renewLease(input) {
    const updated = await prisma.blockchainReconciliationCursor.updateMany({
      where: {
        chainId: input.chainId,
        contractAddress: input.contractAddress.toLowerCase(),
        leaseOwner: input.leaseOwner,
      },
      data: { leaseExpiresAt: input.leaseExpiresAt },
    });
    return updated.count === 1;
  },

  async listReadyEvents(input) {
    const rows = await prisma.blockchainEvent.findMany({
      where: {
        chainId: input.chainId,
        contractAddress: input.contractAddress.toLowerCase(),
        isFinalized: true,
        status: { in: ["PROVISIONAL", "UNMATCHED"] },
      },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      take: input.limit,
    });
    return rows.map(deserializeEvent);
  },

  async applyEvent(event, now) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`blockchain-event:${event.id}`}, 0)
        ) IS NULL AS "acquired"
      `;
      const row = await transaction.blockchainEvent.findUniqueOrThrow({
        where: { id: event.id },
        select: { status: true, isFinalized: true, contractAddress: true },
      });
      if (row.status === "APPLIED") return { kind: "ALREADY_APPLIED" } as const;
      if (
        !row.isFinalized ||
        row.status === "REORGED" ||
        row.status === "CONFLICT"
      ) {
        return {
          kind: "CONFLICT",
          code: "EVENT_NOT_FINAL",
          note: "Event is not finalized.",
        } as const;
      }
      if (event.name === "OFFER_CREATED") {
        return applyOfferCreated(transaction, event, row.contractAddress, now);
      }
      if (event.name === "LOAN_STARTED") {
        return applyLoanStarted(transaction, event, row.contractAddress, now);
      }
      return applyLoanRepaid(transaction, event, row.contractAddress, now);
    });
  },

  async flagConflict(eventId, code, note, now) {
    await prisma.blockchainEvent.updateMany({
      where: { id: eventId, status: { not: "APPLIED" } },
      data: {
        status: "CONFLICT",
        investigationCode: code,
        investigationNote: note,
        processedAt: now,
      },
    });
  },

  async recordRunSuccess(input) {
    await prisma.blockchainReconciliationCursor.updateMany({
      where: {
        chainId: input.chainId,
        contractAddress: input.contractAddress.toLowerCase(),
      },
      data: {
        latestObservedBlock: input.latestObservedBlock,
        lastSuccessfulAt: input.occurredAt,
        consecutiveFailures: 0,
      },
    });
  },

  async recordRunFailure(input) {
    await prisma.blockchainReconciliationCursor.updateMany({
      where: {
        chainId: input.chainId,
        contractAddress: input.contractAddress.toLowerCase(),
      },
      data: {
        lastFailureAt: input.occurredAt,
        consecutiveFailures: { increment: 1 },
      },
    });
  },

  async releaseLease(input) {
    await prisma.blockchainReconciliationCursor.updateMany({
      where: {
        chainId: input.chainId,
        contractAddress: input.contractAddress.toLowerCase(),
        leaseOwner: input.leaseOwner,
      },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
  },
};
