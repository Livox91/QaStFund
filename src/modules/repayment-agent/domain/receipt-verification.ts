import { decodeEventLog } from "viem";

import { erc20UsdcAbi } from "@/integrations/arc/employee-lending-escrow";
import { escrowV3Abi } from "@/integrations/arc/escrow-v3";
import type { PolicyCheck } from "@/modules/repayment-agent/domain/agent-run";

export type RepaymentVerification =
  | Readonly<{
      status: "PENDING";
      /** False when the node has never seen the transaction. */
      transactionKnown: boolean;
      checks: ReadonlyArray<PolicyCheck>;
    }>
  | Readonly<{
      status: "REVERTED";
      errorName: string | null;
      retryable: boolean;
      checks: ReadonlyArray<PolicyCheck>;
    }>
  | Readonly<{ status: "MISMATCH"; checks: ReadonlyArray<PolicyCheck> }>
  | Readonly<{
      status: "VERIFIED";
      checks: ReadonlyArray<PolicyCheck>;
      totalRepaidBaseUnits: bigint;
      remainingBaseUnits: bigint;
      blockNumber: bigint;
      blockTimestamp: Date;
    }>;

type ExpectedLogs = Readonly<{
  contractAddress: string;
  usdcAddress: string;
  chainLoanId: string;
  chainRepaymentId: string;
  amountBaseUnits: bigint;
  borrower: string;
  lender: string;
  agent: string | null;
}>;

function same(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

type DecodedEscrowEvent = ReturnType<typeof decodeEventLog<typeof escrowV3Abi>>;

/**
 * Verifies a successful receipt's logs against exactly one expected repayment.
 * Anything extra or missing is a mismatch, never a partial success.
 */
export function verifyRepaymentLogs(
  logs: ReadonlyArray<{
    address: string;
    data: `0x${string}`;
    topics: readonly `0x${string}`[];
  }>,
  expected: ExpectedLogs,
):
  | Readonly<{
      verified: true;
      checks: PolicyCheck[];
      totalRepaidBaseUnits: bigint;
      remainingBaseUnits: bigint;
    }>
  | Readonly<{ verified: false; checks: PolicyCheck[] }> {
  const checks: PolicyCheck[] = [];
  const escrowEvents: DecodedEscrowEvent[] = [];
  const usdcTransfers: Array<{ from: string; to: string; value: bigint }> = [];

  for (const log of logs) {
    if (same(log.address, expected.contractAddress)) {
      try {
        escrowEvents.push(
          decodeEventLog({
            abi: escrowV3Abi,
            data: log.data,
            topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
          }),
        );
      } catch {
        // Unrelated escrow log.
      }
    } else if (same(log.address, expected.usdcAddress)) {
      try {
        const decoded = decodeEventLog({
          abi: erc20UsdcAbi,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        if (decoded.eventName === "Transfer") {
          usdcTransfers.push(decoded.args);
        }
      } catch {
        // Approval or other token log.
      }
    }
  }

  const received = escrowEvents.filter(
    (event) => event.eventName === "LoanRepaymentReceived",
  );
  const matching = received.filter(
    (event) =>
      event.eventName === "LoanRepaymentReceived" &&
      event.args.loanId === BigInt(expected.chainLoanId) &&
      same(event.args.repaymentId, expected.chainRepaymentId) &&
      event.args.amount === expected.amountBaseUnits &&
      same(event.args.borrower, expected.borrower) &&
      same(event.args.lender, expected.lender) &&
      same(event.args.payer, expected.borrower),
  );
  checks.push({
    code: "REPAYMENT_EVENT_EXACT",
    passed: received.length === 1 && matching.length === 1,
    detail: `Found ${matching.length} matching of ${received.length} LoanRepaymentReceived events.`,
  });

  if (expected.agent) {
    const agentEvents = escrowEvents.filter(
      (event) =>
        event.eventName === "AgentRepaymentExecuted" &&
        same(event.args.agent, expected.agent ?? "") &&
        event.args.amount === expected.amountBaseUnits &&
        same(event.args.repaymentId, expected.chainRepaymentId),
    );
    checks.push({
      code: "AGENT_EVENT_EXACT",
      passed: agentEvents.length === 1,
      detail:
        "AgentRepaymentExecuted names this agent, amount and repayment id.",
    });
  }

  const transfersFromBorrower = usdcTransfers.filter((transfer) =>
    same(transfer.from, expected.borrower),
  );
  const exactTransfer = transfersFromBorrower.filter(
    (transfer) =>
      same(transfer.to, expected.lender) &&
      transfer.value === expected.amountBaseUnits,
  );
  checks.push({
    code: "USDC_TRANSFER_EXACT",
    passed: transfersFromBorrower.length === 1 && exactTransfer.length === 1,
    detail: `${transfersFromBorrower.length} USDC transfer(s) left the borrower; expected exactly one to the lender.`,
  });

  const event = matching[0];
  if (!event || event.eventName !== "LoanRepaymentReceived") {
    return { verified: false, checks };
  }
  const repaidEvents = escrowEvents.filter(
    (item) => item.eventName === "LoanRepaid",
  );
  checks.push({
    code: "COMPLETION_EVENT_CONSISTENT",
    passed:
      event.args.remaining === 0n
        ? repaidEvents.length === 1
        : repaidEvents.length === 0,
    detail:
      event.args.remaining === 0n
        ? "Loan fully repaid; LoanRepaid emitted once."
        : "Loan still open; no LoanRepaid event.",
  });
  if (!checks.every((item) => item.passed)) {
    return { verified: false, checks };
  }
  return {
    verified: true,
    checks,
    totalRepaidBaseUnits: event.args.totalRepaid,
    remainingBaseUnits: event.args.remaining,
  };
}
