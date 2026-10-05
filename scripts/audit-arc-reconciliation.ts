import "dotenv/config";

import { createPublicClient, getAddress, http, type Hex } from "viem";

import { prisma } from "@/infrastructure/database/prisma";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_USDC_ADDRESS,
} from "@/integrations/arc/arc-testnet";
import {
  employeeLendingEscrowAbi,
  getConfiguredEscrowAddress,
} from "@/integrations/arc/employee-lending-escrow";

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
let checkedReceipts = 0;
const normalizedContract = contractAddress.toLowerCase();

function issue(value: AuditIssue) {
  issues.push(value);
}

const actualChainId = await client.getChainId();
if (actualChainId !== ARC_TESTNET_CHAIN_ID) {
  issue({
    code: "CHAIN_ID_MISMATCH",
    recordType: "configuration",
    recordId: normalizedContract,
    detail: `Expected ${ARC_TESTNET_CHAIN_ID}; RPC returned ${actualChainId}.`,
  });
}

const [configuredToken, configuredSigner, offers, loans, journalProblems] =
  await Promise.all([
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
        lenderWalletAddress: true,
        principalBaseUnits: true,
        feeRateBasisPoints: true,
        durationDays: true,
        fundingTransactionHash: true,
      },
      orderBy: { createdAt: "asc" },
      take: MAX_RECORDS,
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
      },
      orderBy: { createdAt: "asc" },
      take: MAX_RECORDS,
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
      take: MAX_RECORDS,
    }),
  ]);

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
) {
  if (!transactionHash) {
    issue({
      code: "MISSING_TRANSACTION_HASH",
      recordType,
      recordId,
      detail: `${purpose} transaction hash is missing.`,
    });
    return;
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
    }
  } catch {
    issue({
      code: "RECEIPT_UNAVAILABLE",
      recordType,
      recordId,
      detail: `${purpose} receipt ${transactionHash} is unavailable from the configured RPC.`,
    });
  }
}

for (const offer of offers) {
  await checkSuccessfulReceipt(
    "offer",
    offer.id,
    offer.fundingTransactionHash,
    "Funding",
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
  );
  if (loan.status === "REPAID") {
    await checkSuccessfulReceipt(
      "loan",
      loan.id,
      loan.repaymentTransactionHash,
      "Repayment",
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
const [staleOffers, staleLoans, staleRepayments] = await Promise.all([
  prisma.lendingOffer.findMany({
    where: {
      contractAddress: normalizedContract,
      fundingStatus: "PENDING",
      updatedAt: { lt: staleBefore },
    },
    select: { id: true },
    take: MAX_RECORDS,
  }),
  prisma.loan.findMany({
    where: {
      contractAddress: normalizedContract,
      status: "REQUESTED",
      updatedAt: { lt: staleBefore },
    },
    select: { id: true },
    take: MAX_RECORDS,
  }),
  prisma.loanRepayment.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: staleBefore },
      loan: { contractAddress: normalizedContract },
    },
    select: { id: true },
    take: MAX_RECORDS,
  }),
]);
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
  limitPerCategory: MAX_RECORDS,
  issues,
};
console.info(JSON.stringify(report, null, 2));
await prisma.$disconnect();
if (!report.ok) process.exitCode = 1;
