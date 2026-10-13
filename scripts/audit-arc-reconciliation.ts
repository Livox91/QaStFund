import "dotenv/config";

import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Hex,
} from "viem";

import { prisma } from "@/infrastructure/database/prisma";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_USDC_ADDRESS,
} from "@/integrations/arc/arc-testnet";
import {
  employeeLendingEscrowAbi,
  erc20UsdcAbi,
  fundingRequestIdToBytes32,
  getConfiguredEscrowAddress,
} from "@/integrations/arc/employee-lending-escrow";
import { enforceAuditRecordBound } from "./audit-record-bound";

type AuditIssue = Readonly<{
  code: string;
  recordType: "configuration" | "journal" | "loan" | "offer" | "intent";
  recordId: string;
  detail: string;
}>;

const MAX_RECORDS = 500;
const contractAddress = getConfiguredEscrowAddress();
if (!contractAddress) {
  throw new Error(
    "NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS must contain a deployed escrow address.",
  );
}

const rpcUrl =
  process.env.ARC_RECONCILIATION_RPC_URL ??
  process.env.ARC_RPC_URL ??
  "https://rpc.testnet.arc.network";
const client = createPublicClient({ transport: http(rpcUrl) });
const issues: AuditIssue[] = [];
const receiptEvidence: Array<{
  purpose: string;
  transactionHash: string;
  blockNumber: string;
  blockTimestamp: string;
  confirmations: string;
  contractEvent: string;
  contractEventLogIndex: number;
  transfer: { from: string; to: string; value: string };
}> = [];
let checkedReceipts = 0;
const normalizedContract = contractAddress.toLowerCase();

function issue(value: AuditIssue) {
  issues.push(value);
}

const [actualChainId, latestBlock] = await Promise.all([
  client.getChainId(),
  client.getBlockNumber(),
]);
if (actualChainId !== ARC_TESTNET_CHAIN_ID) {
  issue({
    code: "CHAIN_ID_MISMATCH",
    recordType: "configuration",
    recordId: normalizedContract,
    detail: `Expected ${ARC_TESTNET_CHAIN_ID}; RPC returned ${actualChainId}.`,
  });
}

const [
  configuredToken,
  configuredSigner,
  unboundedOffers,
  unboundedLoans,
  unboundedJournalProblems,
] = await Promise.all([
  client.readContract({
    address: contractAddress,
    abi: employeeLendingEscrowAbi,
    functionName: "usdc",
  }),
  client.readContract({
    address: contractAddress,
    abi: employeeLendingEscrowAbi,
    functionName: "authorizationSigner",
  }),
  prisma.lendingOffer.findMany({
    where: {
      contractAddress: normalizedContract,
      fundingStatus: "FUNDED",
      chainOfferId: { not: null },
    },
    select: {
      id: true,
      status: true,
      chainOfferId: true,
      fundingRequestId: true,
      lenderWalletAddress: true,
      principalBaseUnits: true,
      feeRateBasisPoints: true,
      durationDays: true,
      fundingTransactionHash: true,
      fundedAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: MAX_RECORDS + 1,
  }),
  prisma.loan.findMany({
    where: {
      contractAddress: normalizedContract,
      chainLoanId: { not: null },
    },
    select: {
      id: true,
      status: true,
      chainLoanId: true,
      chainOfferId: true,
      lenderWalletAddress: true,
      borrowerWalletAddress: true,
      principalBaseUnits: true,
      repaymentBaseUnits: true,
      acceptanceTransactionHash: true,
      repaymentTransactionHash: true,
      onChainStartedAt: true,
      onChainRepaidAt: true,
      repayments: {
        where: { status: "COMPLETED" },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_RECORDS + 1,
  }),
  prisma.blockchainEvent.findMany({
    where: {
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: normalizedContract,
      status: { in: ["UNMATCHED", "CONFLICT", "REORGED"] },
    },
    select: {
      id: true,
      status: true,
      investigationCode: true,
      investigationNote: true,
    },
    orderBy: { blockNumber: "asc" },
    take: MAX_RECORDS + 1,
  }),
]);

const boundedCategories = {
  offers: enforceAuditRecordBound(unboundedOffers, MAX_RECORDS),
  loans: enforceAuditRecordBound(unboundedLoans, MAX_RECORDS),
  journalProblems: enforceAuditRecordBound(
    unboundedJournalProblems,
    MAX_RECORDS,
  ),
};
const {
  offers: { records: offers },
  loans: { records: loans },
  journalProblems: { records: journalProblems },
} = boundedCategories;

for (const [category, result] of Object.entries(boundedCategories)) {
  if (!result.overflowed) continue;
  issue({
    code: "AUDIT_RECORD_LIMIT_EXCEEDED",
    recordType: "configuration",
    recordId: category,
    detail: `${category} contains more than ${MAX_RECORDS} records; the bounded audit refuses to report success until pagination is implemented.`,
  });
}

if (configuredToken.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) {
  issue({
    code: "TOKEN_MISMATCH",
    recordType: "configuration",
    recordId: normalizedContract,
    detail: `Escrow token is ${configuredToken}; expected ${ARC_USDC_ADDRESS}.`,
  });
}
const expectedSigner = process.env.ARC_BORROW_AUTHORIZER_ADDRESS;
if (
  expectedSigner &&
  configuredSigner.toLowerCase() !== getAddress(expectedSigner).toLowerCase()
) {
  issue({
    code: "AUTHORIZER_MISMATCH",
    recordType: "configuration",
    recordId: normalizedContract,
    detail: `Escrow signer is ${configuredSigner}; configured signer is ${expectedSigner}.`,
  });
}

for (const event of journalProblems) {
  issue({
    code: `JOURNAL_${event.status}`,
    recordType: "journal",
    recordId: event.id,
    detail:
      [event.investigationCode, event.investigationNote]
        .filter(Boolean)
        .join(": ") || "Reconciliation journal requires investigation.",
  });
}

async function checkSuccessfulReceipt(
  recordType: "loan" | "offer",
  recordId: string,
  transactionHash: string | null,
  purpose: string,
  expected: Readonly<{
    eventName: "OfferCreated" | "LoanStarted" | "LoanRepaid";
    journalName: "OFFER_CREATED" | "LOAN_STARTED" | "LOAN_REPAID";
    journalRecordId: string;
    eventMatches(args: Record<string, unknown>): boolean;
    transfer: { from: string; to: string; value: bigint };
  }>,
) {
  if (!transactionHash) {
    issue({
      code: "MISSING_TRANSACTION_HASH",
      recordType,
      recordId,
      detail: `${purpose} transaction hash is missing.`,
    });
    return null;
  }
  checkedReceipts += 1;
  try {
    const receipt = await client.getTransactionReceipt({
      hash: transactionHash as Hex,
    });
    if (receipt.status !== "success") {
      issue({
        code: "TRANSACTION_REVERTED",
        recordType,
        recordId,
        detail: `${purpose} receipt ${transactionHash} is reverted.`,
      });
      return null;
    }
    let matchingEvent:
      | { logIndex: number; name: string; args: Record<string, unknown> }
      | undefined;
    let matchingTransfer:
      { from: string; to: string; value: bigint } | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === normalizedContract) {
        try {
          const decoded = decodeEventLog({
            abi: employeeLendingEscrowAbi,
            data: log.data,
            topics: log.topics,
          });
          const args = decoded.args as Record<string, unknown>;
          if (
            decoded.eventName === expected.eventName &&
            expected.eventMatches(args)
          ) {
            matchingEvent = {
              logIndex: log.logIndex,
              name: decoded.eventName,
              args,
            };
          }
        } catch {}
      }
      if (log.address.toLowerCase() === ARC_USDC_ADDRESS.toLowerCase()) {
        try {
          const decoded = decodeEventLog({
            abi: erc20UsdcAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "Transfer") {
            const transfer = decoded.args;
            if (
              transfer.from.toLowerCase() ===
                expected.transfer.from.toLowerCase() &&
              transfer.to.toLowerCase() ===
                expected.transfer.to.toLowerCase() &&
              transfer.value === expected.transfer.value
            ) {
              matchingTransfer = transfer;
            }
          }
        } catch {}
      }
    }
    if (!matchingEvent) {
      issue({
        code: "EXPECTED_CONTRACT_EVENT_MISSING",
        recordType,
        recordId,
        detail: `${purpose} receipt ${transactionHash} does not contain the exact expected ${expected.eventName} event.`,
      });
    }
    if (!matchingTransfer) {
      issue({
        code: "EXPECTED_USDC_TRANSFER_MISSING",
        recordType,
        recordId,
        detail: `${purpose} receipt ${transactionHash} does not contain the exact expected USDC transfer.`,
      });
    }
    const journalEvent = matchingEvent
      ? await prisma.blockchainEvent.findUnique({
          where: {
            chainId_contractAddress_transactionHash_logIndex: {
              chainId: ARC_TESTNET_CHAIN_ID,
              contractAddress: normalizedContract,
              transactionHash: transactionHash.toLowerCase(),
              logIndex: matchingEvent.logIndex,
            },
          },
          select: {
            name: true,
            status: true,
            isFinalized: true,
            matchedRecordId: true,
          },
        })
      : null;
    if (
      !journalEvent ||
      journalEvent.name !== expected.journalName ||
      journalEvent.status !== "APPLIED" ||
      !journalEvent.isFinalized ||
      journalEvent.matchedRecordId !== expected.journalRecordId
    ) {
      issue({
        code: "JOURNAL_EVENT_NOT_APPLIED",
        recordType,
        recordId,
        detail: `${purpose} transaction ${transactionHash} is not linked to the expected finalized application record.`,
      });
    }
    if (matchingEvent && matchingTransfer) {
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      receiptEvidence.push({
        purpose,
        transactionHash: transactionHash.toLowerCase(),
        blockNumber: receipt.blockNumber.toString(),
        blockTimestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
        confirmations: (latestBlock - receipt.blockNumber + 1n).toString(),
        contractEvent: matchingEvent.name,
        contractEventLogIndex: matchingEvent.logIndex,
        transfer: {
          from: matchingTransfer.from.toLowerCase(),
          to: matchingTransfer.to.toLowerCase(),
          value: matchingTransfer.value.toString(),
        },
      });
    }
    return receipt;
  } catch {
    issue({
      code: "RECEIPT_UNAVAILABLE",
      recordType,
      recordId,
      detail: `${purpose} receipt ${transactionHash} is unavailable from the configured RPC.`,
    });
    return null;
  }
}

for (const offer of offers) {
  await checkSuccessfulReceipt(
    "offer",
    offer.id,
    offer.fundingTransactionHash,
    "Funding",
    {
      eventName: "OfferCreated",
      journalName: "OFFER_CREATED",
      journalRecordId: offer.id,
      eventMatches: (args) =>
        args.offerId === BigInt(offer.chainOfferId!) &&
        String(args.lender).toLowerCase() ===
          offer.lenderWalletAddress?.toLowerCase() &&
        args.principal === offer.principalBaseUnits &&
        args.interestBps === BigInt(offer.feeRateBasisPoints) &&
        args.duration === BigInt(offer.durationDays * 86_400) &&
        String(args.requestId).toLowerCase() ===
          fundingRequestIdToBytes32(offer.fundingRequestId!).toLowerCase(),
      transfer: {
        from: offer.lenderWalletAddress!,
        to: normalizedContract,
        value: offer.principalBaseUnits!,
      },
    },
  );
  const chainOfferId = BigInt(offer.chainOfferId!);
  const chainOffer = await client.readContract({
    address: contractAddress,
    abi: employeeLendingEscrowAbi,
    functionName: "offers",
    args: [chainOfferId],
  });
  const expectedActive = offer.status === "ACTIVE";
  const matches =
    chainOffer[0] === chainOfferId &&
    chainOffer[1].toLowerCase() === offer.lenderWalletAddress?.toLowerCase() &&
    chainOffer[2] === offer.principalBaseUnits &&
    chainOffer[3] === BigInt(offer.feeRateBasisPoints) &&
    chainOffer[4] === BigInt(offer.durationDays * 86_400) &&
    chainOffer[5] === expectedActive;
  if (!matches) {
    issue({
      code: "OFFER_STATE_MISMATCH",
      recordType: "offer",
      recordId: offer.id,
      detail: `Database offer ${offer.chainOfferId} does not match its escrow state.`,
    });
  }
}

const expectedLoanStatus = new Map([
  ["ACTIVE", 0],
  ["OVERDUE", 0],
  ["REPAID", 1],
  // Default classification is application-side; the current escrow exposes no
  // default transition, so a defaulted debt remains ACTIVE on chain.
  ["DEFAULTED", 0],
]);
for (const loan of loans) {
  await checkSuccessfulReceipt(
    "loan",
    loan.id,
    loan.acceptanceTransactionHash,
    "Acceptance",
    {
      eventName: "LoanStarted",
      journalName: "LOAN_STARTED",
      journalRecordId: loan.id,
      eventMatches: (args) =>
        args.loanId === BigInt(loan.chainLoanId!) &&
        args.offerId === BigInt(loan.chainOfferId!) &&
        String(args.lender).toLowerCase() ===
          loan.lenderWalletAddress?.toLowerCase() &&
        String(args.borrower).toLowerCase() ===
          loan.borrowerWalletAddress?.toLowerCase() &&
        args.principal === loan.principalBaseUnits &&
        args.repaymentAmount === loan.repaymentBaseUnits,
      transfer: {
        from: normalizedContract,
        to: loan.borrowerWalletAddress!,
        value: loan.principalBaseUnits!,
      },
    },
  );
  if (loan.status === "REPAID") {
    await checkSuccessfulReceipt(
      "loan",
      loan.id,
      loan.repaymentTransactionHash,
      "Repayment",
      {
        eventName: "LoanRepaid",
        journalName: "LOAN_REPAID",
        journalRecordId: loan.repayments[0]?.id ?? "",
        eventMatches: (args) =>
          args.loanId === BigInt(loan.chainLoanId!) &&
          String(args.lender).toLowerCase() ===
            loan.lenderWalletAddress?.toLowerCase() &&
          String(args.borrower).toLowerCase() ===
            loan.borrowerWalletAddress?.toLowerCase() &&
          args.amount === loan.repaymentBaseUnits,
        transfer: {
          from: loan.borrowerWalletAddress!,
          to: loan.lenderWalletAddress!,
          value: loan.repaymentBaseUnits!,
        },
      },
    );
  }
  const chainLoanId = BigInt(loan.chainLoanId!);
  const chainLoan = await client.readContract({
    address: contractAddress,
    abi: employeeLendingEscrowAbi,
    functionName: "loans",
    args: [chainLoanId],
  });
  const expectedStatus = expectedLoanStatus.get(loan.status);
  const matches =
    expectedStatus !== undefined &&
    chainLoan[0] === chainLoanId &&
    chainLoan[1] === BigInt(loan.chainOfferId!) &&
    chainLoan[2].toLowerCase() === loan.lenderWalletAddress?.toLowerCase() &&
    chainLoan[3].toLowerCase() === loan.borrowerWalletAddress?.toLowerCase() &&
    chainLoan[4] === loan.principalBaseUnits &&
    chainLoan[6] === loan.repaymentBaseUnits &&
    chainLoan[9] === expectedStatus;
  if (!matches) {
    issue({
      code: "LOAN_STATE_MISMATCH",
      recordType: "loan",
      recordId: loan.id,
      detail: `Database loan ${loan.chainLoanId} does not match its escrow state.`,
    });
  }
}

const staleBefore = new Date(Date.now() - 15 * 60_000);
const [unboundedStaleOffers, unboundedStaleLoans, unboundedStaleRepayments] =
  await Promise.all([
    prisma.lendingOffer.findMany({
      where: {
        contractAddress: normalizedContract,
        fundingStatus: "PENDING",
        updatedAt: { lt: staleBefore },
      },
      select: { id: true },
      take: MAX_RECORDS + 1,
    }),
    prisma.loan.findMany({
      where: {
        contractAddress: normalizedContract,
        status: { in: ["REQUESTED", "APPROVED"] },
        updatedAt: { lt: staleBefore },
      },
      select: { id: true },
      take: MAX_RECORDS + 1,
    }),
    prisma.loanRepayment.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: staleBefore },
        loan: { contractAddress: normalizedContract },
      },
      select: { id: true },
      take: MAX_RECORDS + 1,
    }),
  ]);
const boundedStaleCategories = {
  staleOffers: enforceAuditRecordBound(unboundedStaleOffers, MAX_RECORDS),
  staleLoans: enforceAuditRecordBound(unboundedStaleLoans, MAX_RECORDS),
  staleRepayments: enforceAuditRecordBound(
    unboundedStaleRepayments,
    MAX_RECORDS,
  ),
};
const {
  staleOffers: { records: staleOffers },
  staleLoans: { records: staleLoans },
  staleRepayments: { records: staleRepayments },
} = boundedStaleCategories;

for (const [category, result] of Object.entries(boundedStaleCategories)) {
  if (!result.overflowed) continue;
  issue({
    code: "AUDIT_RECORD_LIMIT_EXCEEDED",
    recordType: "configuration",
    recordId: category,
    detail: `${category} contains more than ${MAX_RECORDS} records; the bounded audit refuses to report success until pagination is implemented.`,
  });
}
for (const record of [
  ...staleOffers.map((row) => ({ ...row, kind: "offer" as const })),
  ...staleLoans.map((row) => ({ ...row, kind: "loan" as const })),
  ...staleRepayments.map((row) => ({ ...row, kind: "repayment" as const })),
]) {
  issue({
    code: "STALE_PENDING_INTENT",
    recordType: "intent",
    recordId: record.id,
    detail: `${record.kind} has remained pending for more than 15 minutes.`,
  });
}

const report = {
  ok: issues.length === 0,
  readOnly: true,
  chainId: actualChainId,
  contractAddress,
  checked: {
    offers: offers.length,
    loans: loans.length,
    journalProblems: journalProblems.length,
    receipts: checkedReceipts,
    staleIntents:
      staleOffers.length + staleLoans.length + staleRepayments.length,
  },
  receiptEvidence,
  limitPerCategory: MAX_RECORDS,
  issues,
};
console.info(JSON.stringify(report, null, 2));
await prisma.$disconnect();
if (!report.ok) process.exitCode = 1;
