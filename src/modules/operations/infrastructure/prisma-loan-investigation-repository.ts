import "server-only";

import { prisma } from "@/infrastructure/database/prisma";
import type { LoanInvestigationRepository } from "@/modules/operations/application/loan-investigation";
import { sanitizeOperationalEvidence } from "@/modules/operations/infrastructure/safe-operational-evidence";

function transactionPhase(input: {
  status: string;
  transactionHash: string | null;
  completed: boolean;
}) {
  if (input.completed) return "CONFIRMED";
  if (input.status === "FAILED") return "FAILED";
  return input.transactionHash ? "CONFIRMATION" : "SUBMISSION";
}

export const prismaLoanInvestigationRepository: LoanInvestigationRepository = {
  async findOperationalTrace({ organizationId, loanId }) {
    const loan = await prisma.loan.findFirst({
      where: { id: loanId, organizationId },
      select: {
        id: true,
        organizationId: true,
        lendingOfferId: true,
        borrowRequestId: true,
        status: true,
        principalBaseUnits: true,
        repaymentBaseUnits: true,
        outstandingPrincipalMinorUnits: true,
        currency: true,
        requestedAt: true,
        approvedAt: true,
        activatedAt: true,
        closedAt: true,
        repaymentDueAt: true,
        chainLoanId: true,
        chainOfferId: true,
        contractAddress: true,
        acceptanceTransactionHash: true,
        repaymentTransactionHash: true,
        onChainStartedAt: true,
        onChainDueAt: true,
        onChainRepaidAt: true,
        lendingOffer: {
          select: {
            id: true,
            status: true,
            fundingStatus: true,
            fundingRequestId: true,
            chainOfferId: true,
            contractAddress: true,
            fundingTransactionHash: true,
            fundedAt: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        repayments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            repaymentRequestId: true,
            submissionTransactionHash: true,
            amountMinorUnits: true,
            currency: true,
            status: true,
            paidAt: true,
            completedAt: true,
            createdAt: true,
          },
        },
        originationDecisions: {
          orderBy: { evaluatedAt: "asc" },
          select: {
            id: true,
            idempotencyKey: true,
            modelVersion: true,
            status: true,
            score: true,
            reasonCodes: true,
            evaluatedAt: true,
            override: {
              select: {
                id: true,
                outcome: true,
                reviewedAt: true,
              },
            },
          },
        },
        decisionEvaluations: {
          orderBy: { evaluatedAt: "asc" },
          select: {
            id: true,
            classification: true,
            recommendedAction: true,
            reasonCodes: true,
            source: true,
            modelVersion: true,
            evaluatedAt: true,
          },
        },
        decisionReviews: {
          orderBy: { reviewedAt: "asc" },
          select: { id: true, evaluationId: true, reviewedAt: true },
        },
        auditEvents: {
          orderBy: { occurredAt: "asc" },
          select: {
            id: true,
            lendingOfferId: true,
            repaymentId: true,
            type: true,
            title: true,
            amountMinorUnits: true,
            currency: true,
            metadata: true,
            occurredAt: true,
          },
        },
      },
    });
    if (!loan) return null;

    const repaymentIds = loan.repayments.map((repayment) => repayment.id);
    const transactionHashes = [
      loan.lendingOffer?.fundingTransactionHash,
      loan.acceptanceTransactionHash,
      loan.repaymentTransactionHash,
      ...loan.repayments.map(
        (repayment) => repayment.submissionTransactionHash,
      ),
    ].filter((value): value is string => Boolean(value));

    const [ledgerTransactions, blockchainEvents, incidents] = await Promise.all(
      [
        prisma.ledgerTransaction.findMany({
          where: {
            organizationId,
            OR: [
              { referenceType: "LOAN", referenceId: loan.id },
              ...(repaymentIds.length > 0
                ? [
                    {
                      referenceType: "REPAYMENT" as const,
                      referenceId: { in: repaymentIds },
                    },
                  ]
                : []),
            ],
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            type: true,
            status: true,
            referenceType: true,
            referenceId: true,
            idempotencyKey: true,
            createdAt: true,
            completedAt: true,
            entries: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                direction: true,
                amountMinorUnits: true,
                asset: true,
                createdAt: true,
              },
            },
          },
        }),
        transactionHashes.length > 0
          ? prisma.blockchainEvent.findMany({
              where: { transactionHash: { in: transactionHashes } },
              orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
              select: {
                id: true,
                chainId: true,
                contractAddress: true,
                blockNumber: true,
                blockHash: true,
                transactionHash: true,
                logIndex: true,
                name: true,
                status: true,
                isFinalized: true,
                payload: true,
                matchedRecordId: true,
                investigationCode: true,
                observedAt: true,
                finalizedAt: true,
                processedAt: true,
              },
            })
          : Promise.resolve([]),
        prisma.operationalIncident.findMany({
          where: {
            OR: [
              {
                organizationId,
                safeReferenceId: {
                  in: [
                    loan.id,
                    ...repaymentIds,
                    ...(loan.lendingOfferId ? [loan.lendingOfferId] : []),
                  ],
                },
              },
              {
                organizationId: null,
                subsystem: {
                  in: [
                    "reconciliation",
                    "transaction_confirmation",
                    "repayments",
                  ],
                },
              },
            ],
          },
          orderBy: { lastDetectedAt: "asc" },
          select: {
            id: true,
            subsystem: true,
            kind: true,
            severity: true,
            status: true,
            safeReferenceId: true,
            summary: true,
            remediation: true,
            occurrenceCount: true,
            firstDetectedAt: true,
            lastDetectedAt: true,
            recoveredAt: true,
          },
        }),
      ],
    );

    const transactions = [
      ...(loan.lendingOffer
        ? [
            {
              operation: "OFFER_FUNDING",
              referenceId: loan.lendingOffer.id,
              phase: transactionPhase({
                status: loan.lendingOffer.fundingStatus,
                transactionHash: loan.lendingOffer.fundingTransactionHash,
                completed: loan.lendingOffer.fundingStatus === "FUNDED",
              }),
              transactionHash: loan.lendingOffer.fundingTransactionHash,
              completedAt: loan.lendingOffer.fundedAt,
            },
          ]
        : []),
      {
        operation: "LOAN_ACCEPTANCE",
        referenceId: loan.id,
        phase: transactionPhase({
          status: loan.status,
          transactionHash: loan.acceptanceTransactionHash,
          completed: ["ACTIVE", "OVERDUE", "REPAID"].includes(loan.status),
        }),
        transactionHash: loan.acceptanceTransactionHash,
        completedAt: loan.onChainStartedAt,
      },
      ...loan.repayments.map((repayment) => ({
        operation: "REPAYMENT",
        referenceId: repayment.id,
        phase: transactionPhase({
          status: repayment.status,
          transactionHash: repayment.submissionTransactionHash,
          completed: repayment.status === "COMPLETED",
        }),
        transactionHash: repayment.submissionTransactionHash,
        completedAt: repayment.completedAt,
      })),
    ];

    return sanitizeOperationalEvidence({
      generatedAt: new Date(),
      loan: {
        id: loan.id,
        organizationId: loan.organizationId,
        lendingOfferId: loan.lendingOfferId,
        borrowRequestId: loan.borrowRequestId,
        status: loan.status,
        principalBaseUnits: loan.principalBaseUnits,
        repaymentBaseUnits: loan.repaymentBaseUnits,
        outstandingPrincipalMinorUnits: loan.outstandingPrincipalMinorUnits,
        currency: loan.currency,
        requestedAt: loan.requestedAt,
        approvedAt: loan.approvedAt,
        activatedAt: loan.activatedAt,
        closedAt: loan.closedAt,
        repaymentDueAt: loan.repaymentDueAt,
        chainLoanId: loan.chainLoanId,
        chainOfferId: loan.chainOfferId,
        contractAddress: loan.contractAddress,
        onChainStartedAt: loan.onChainStartedAt,
        onChainDueAt: loan.onChainDueAt,
        onChainRepaidAt: loan.onChainRepaidAt,
      },
      applicationAndDecisions: {
        origination: loan.originationDecisions,
        monitoringEvaluations: loan.decisionEvaluations,
        reviews: loan.decisionReviews,
      },
      offerLifecycle: loan.lendingOffer,
      transactions,
      contractEvents: blockchainEvents,
      usdcTransferEvidence: blockchainEvents.map((event) => ({
        source: "CANONICAL_ESCROW_EVENT",
        transactionHash: event.transactionHash,
        eventName: event.name,
        status: event.status,
        payload: event.payload,
      })),
      ledger: ledgerTransactions,
      auditEvents: loan.auditEvents,
      incidents,
    }) as Record<string, unknown>;
  },
};
