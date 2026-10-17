import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  toHex,
  type Abi,
} from "viem";

import { erc20UsdcAbi } from "@/integrations/arc/employee-lending-escrow";
import {
  NON_RETRYABLE_ESCROW_ERRORS,
  escrowV3Abi,
} from "@/integrations/arc/escrow-v3";
import type {
  AgentRepaymentRequest,
  BorrowerChainState,
  ChainLoanState,
  ExpectedRepayment,
  RepaymentChainGateway,
  SimulationResult,
} from "@/modules/repayment-agent/application/ports";
import type { MandateSnapshot } from "@/modules/repayment-agent/domain/agent-policy";
import {
  verifyRepaymentLogs,
  type RepaymentVerification,
} from "@/modules/repayment-agent/domain/receipt-verification";
import type { Clock } from "@/shared/time/clock";

export type SubmissionFault =
  | "PENDING"
  | "TRANSIENT_REVERT"
  | "DROPPED"
  | "TAMPERED_RECEIPT"
  /** The node errors on broadcast but the transaction still lands. */
  | "BROADCAST_ERROR_LANDED"
  /** Signing fails, so nothing is ever sent. */
  | "SIGNING_ERROR";

type SimLog = {
  address: `0x${string}`;
  topics: `0x${string}`[];
  data: `0x${string}`;
};

type SimTransaction =
  | { status: "unknown" }
  | { status: "pending"; request: AgentRepaymentRequest }
  | { status: "reverted"; errorName: string | null }
  | { status: "success"; logs: SimLog[]; blockNumber: bigint };

type MutableMandate = {
  -readonly [key in keyof MandateSnapshot]: MandateSnapshot[key];
};

export type SimTransfer = Readonly<{
  from: string;
  to: string;
  amountBaseUnits: bigint;
  chainRepaymentId: string;
  chainLoanId: string;
}>;

function eventLog(
  address: `0x${string}`,
  abi: Abi,
  eventName: string,
  args: Record<string, unknown>,
): SimLog {
  const event = abi.find(
    (item) => item.type === "event" && item.name === eventName,
  ) as unknown as {
    inputs: Array<{ name: string; type: string; indexed?: boolean }>;
  };
  const topics = encodeEventTopics({
    abi,
    eventName,
    args,
  } as never) as `0x${string}`[];
  const nonIndexed = event.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(
    nonIndexed as never,
    nonIndexed.map((input) => args[input.name]) as never,
  );
  return { address, topics, data };
}

/**
 * In-memory model of EmployeeLendingEscrowV3 used by agent evaluations. It
 * mirrors `repayOnBehalf` exactly (the Solidity contract remains the real
 * enforcement and is tested separately) and emits ABI-encoded logs so the
 * production receipt verifier runs unchanged.
 */
export class SimulatedEscrowChain implements RepaymentChainGateway {
  readonly agentAddress = "0x00000000000000000000000000000000000a6e47" as const;
  readonly contractAddress =
    "0x0000000000000000000000000000000000e5c300" as const;
  readonly usdcAddress = "0x0000000000000000000000000000000000005dc0" as const;

  readonly balances = new Map<string, bigint>();
  readonly allowances = new Map<string, bigint>();
  readonly mandates = new Map<string, MutableMandate>();
  readonly loans = new Map<
    string,
    { -readonly [key in keyof ChainLoanState]: ChainLoanState[key] }
  >();
  readonly usedRepaymentIds = new Set<string>();
  readonly transactions = new Map<string, SimTransaction>();
  readonly transfers: SimTransfer[] = [];
  readonly faults: SubmissionFault[] = [];
  submissions = 0;
  /** Runs after signing, before the transaction executes. */
  beforeExecute: (() => void) | null = null;
  private sequence = 0;
  private blockNumber = 1_000n;

  constructor(private readonly clock: Clock) {}

  private key(address: string) {
    return address.toLowerCase();
  }

  setBalance(address: string, amount: bigint) {
    this.balances.set(this.key(address), amount);
  }

  balanceOf(address: string) {
    return this.balances.get(this.key(address)) ?? 0n;
  }

  setMandate(
    borrower: string,
    terms: Omit<
      MandateSnapshot,
      "nonce" | "periodStartedAt" | "spentInPeriodBaseUnits" | "active"
    >,
  ) {
    const previous = this.mandates.get(this.key(borrower));
    this.mandates.set(this.key(borrower), {
      ...terms,
      nonce: (previous?.nonce ?? 0n) + 1n,
      periodStartedAt: this.clock.now(),
      spentInPeriodBaseUnits: 0n,
      active: true,
    });
  }

  addLoan(loan: Omit<ChainLoanState, "active" | "repaidBaseUnits">) {
    this.loans.set(loan.chainLoanId, {
      ...loan,
      repaidBaseUnits: 0n,
      active: true,
    });
  }

  async readBorrowerState(walletAddress: string): Promise<BorrowerChainState> {
    const mandate = this.mandates.get(this.key(walletAddress));
    return {
      walletBalanceBaseUnits: this.balanceOf(walletAddress),
      allowanceBaseUnits: this.allowances.get(this.key(walletAddress)) ?? 0n,
      mandate: mandate && mandate.nonce > 0n ? { ...mandate } : null,
    };
  }

  async readLoan(chainLoanId: string): Promise<ChainLoanState> {
    const loan = this.loans.get(chainLoanId);
    if (!loan) throw new Error("InvalidLoan");
    return { ...loan };
  }

  /** Same checks, in the same order, as `repayOnBehalf`. */
  private revertReason(request: AgentRepaymentRequest): string | null {
    const now = this.clock.now().getTime();
    const loan = this.loans.get(request.chainLoanId);
    if (!loan) return "InvalidLoan";
    if (!loan.active) return "LoanNotActive";
    const mandate = this.mandates.get(this.key(loan.borrower));
    if (!mandate?.active) return "MandateNotActive";
    if (this.key(mandate.agentAddress) !== this.key(this.agentAddress)) {
      return "NotMandateAgent";
    }
    if (mandate.nonce !== request.mandateNonce) return "MandateChanged";
    if (now > mandate.expiresAt.getTime()) return "MandateExpired";
    if (request.amountBaseUnits === 0n) return "InvalidRepayment";
    if (request.amountBaseUnits > mandate.maxPerRepaymentBaseUnits) {
      return "RepaymentCapExceeded";
    }
    if (now + mandate.earliestBeforeDueSeconds * 1_000 < loan.dueAt.getTime()) {
      return "RepaymentWindowNotOpen";
    }
    const periodReset =
      now >= mandate.periodStartedAt.getTime() + mandate.periodSeconds * 1_000;
    const spent = periodReset ? 0n : mandate.spentInPeriodBaseUnits;
    if (spent + request.amountBaseUnits > mandate.maxPerPeriodBaseUnits) {
      return "PeriodCapExceeded";
    }
    if (
      this.balanceOf(loan.borrower) <
      request.amountBaseUnits + mandate.minimumReserveBaseUnits
    ) {
      return "ReserveViolation";
    }
    if (this.usedRepaymentIds.has(request.chainRepaymentId)) {
      return "DuplicateRepayment";
    }
    if (
      request.amountBaseUnits >
      loan.repaymentAmountBaseUnits - loan.repaidBaseUnits
    ) {
      return "RepaymentExceedsOutstanding";
    }
    if (
      (this.allowances.get(this.key(loan.borrower)) ?? 0n) <
      request.amountBaseUnits
    ) {
      return "ERC20InsufficientAllowance";
    }
    return null;
  }

  async simulateAgentRepayment(
    request: AgentRepaymentRequest,
  ): Promise<SimulationResult> {
    const reason = this.revertReason(request);
    return reason ? { ok: false, errorName: reason } : { ok: true };
  }

  private execute(
    request: AgentRepaymentRequest,
    tamper: boolean,
  ): SimTransaction {
    const reason = this.revertReason(request);
    if (reason) return { status: "reverted", errorName: reason };
    const now = this.clock.now();
    const loan = this.loans.get(request.chainLoanId)!;
    const mandate = this.mandates.get(this.key(loan.borrower))!;
    if (
      now.getTime() >=
      mandate.periodStartedAt.getTime() + mandate.periodSeconds * 1_000
    ) {
      mandate.periodStartedAt = now;
      mandate.spentInPeriodBaseUnits = 0n;
    }
    mandate.spentInPeriodBaseUnits += request.amountBaseUnits;
    this.usedRepaymentIds.add(request.chainRepaymentId);
    loan.repaidBaseUnits += request.amountBaseUnits;
    const remaining = loan.repaymentAmountBaseUnits - loan.repaidBaseUnits;
    if (remaining === 0n) loan.active = false;
    this.setBalance(
      loan.borrower,
      this.balanceOf(loan.borrower) - request.amountBaseUnits,
    );
    this.setBalance(
      loan.lender,
      this.balanceOf(loan.lender) + request.amountBaseUnits,
    );
    this.allowances.set(
      this.key(loan.borrower),
      (this.allowances.get(this.key(loan.borrower)) ?? 0n) -
        request.amountBaseUnits,
    );
    this.transfers.push({
      from: loan.borrower,
      to: loan.lender,
      amountBaseUnits: request.amountBaseUnits,
      chainRepaymentId: request.chainRepaymentId,
      chainLoanId: request.chainLoanId,
    });

    const logs: SimLog[] = [
      eventLog(this.usdcAddress, erc20UsdcAbi as Abi, "Transfer", {
        from: loan.borrower,
        to: loan.lender,
        value: tamper ? request.amountBaseUnits + 1n : request.amountBaseUnits,
      }),
      eventLog(
        this.contractAddress,
        escrowV3Abi as Abi,
        "LoanRepaymentReceived",
        {
          loanId: BigInt(request.chainLoanId),
          repaymentId: request.chainRepaymentId,
          borrower: loan.borrower,
          lender: loan.lender,
          payer: loan.borrower,
          amount: request.amountBaseUnits,
          totalRepaid: loan.repaidBaseUnits,
          remaining,
        },
      ),
    ];
    if (remaining === 0n) {
      logs.push(
        eventLog(this.contractAddress, escrowV3Abi as Abi, "LoanRepaid", {
          loanId: BigInt(request.chainLoanId),
          borrower: loan.borrower,
          lender: loan.lender,
          amount: loan.repaymentAmountBaseUnits,
          repaidAt: BigInt(Math.floor(now.getTime() / 1_000)),
        }),
      );
    }
    logs.push(
      eventLog(
        this.contractAddress,
        escrowV3Abi as Abi,
        "AgentRepaymentExecuted",
        {
          loanId: BigInt(request.chainLoanId),
          repaymentId: request.chainRepaymentId,
          agent: this.agentAddress,
          borrower: loan.borrower,
          amount: request.amountBaseUnits,
          mandateNonce: request.mandateNonce,
          spentInPeriod: mandate.spentInPeriodBaseUnits,
        },
      ),
    );
    this.blockNumber += 1n;
    return { status: "success", logs, blockNumber: this.blockNumber };
  }

  async submitAgentRepayment(
    request: AgentRepaymentRequest,
    onSigned: (transactionHash: `0x${string}`) => Promise<void>,
  ): Promise<`0x${string}`> {
    const fault = this.faults.shift();
    if (fault === "SIGNING_ERROR") throw new Error("SIGNING_UNAVAILABLE");
    const hash = keccak256(toHex(`sim-tx-${++this.sequence}`));
    await onSigned(hash);
    this.submissions += 1;
    this.beforeExecute?.();
    this.beforeExecute = null;
    if (fault === "DROPPED") {
      this.transactions.set(hash, { status: "unknown" });
    } else if (fault === "PENDING") {
      this.transactions.set(hash, { status: "pending", request });
    } else if (fault === "TRANSIENT_REVERT") {
      this.transactions.set(hash, { status: "reverted", errorName: null });
    } else {
      this.transactions.set(
        hash,
        this.execute(request, fault === "TAMPERED_RECEIPT"),
      );
    }
    if (fault === "BROADCAST_ERROR_LANDED") {
      // Executed above, but the caller only sees a broadcast error.
      throw new Error("BROADCAST_TIMEOUT");
    }
    return hash;
  }

  /** Mines a transaction that was left pending. */
  minePending() {
    for (const [hash, transaction] of this.transactions) {
      if (transaction.status === "pending") {
        this.transactions.set(hash, this.execute(transaction.request, false));
      }
    }
  }

  async verifyRepayment(
    transactionHash: `0x${string}`,
    expected: ExpectedRepayment,
  ): Promise<RepaymentVerification> {
    const transaction = this.transactions.get(transactionHash) ?? {
      status: "unknown" as const,
    };
    if (transaction.status === "unknown" || transaction.status === "pending") {
      return {
        status: "PENDING",
        transactionKnown: transaction.status === "pending",
        checks: [],
      };
    }
    if (transaction.status === "reverted") {
      return {
        status: "REVERTED",
        errorName: transaction.errorName,
        retryable:
          transaction.errorName === null ||
          !NON_RETRYABLE_ESCROW_ERRORS.has(transaction.errorName),
        checks: [],
      };
    }
    const result = verifyRepaymentLogs(transaction.logs, {
      contractAddress: this.contractAddress,
      usdcAddress: this.usdcAddress,
      ...expected,
    });
    if (!result.verified) return { status: "MISMATCH", checks: result.checks };
    return {
      status: "VERIFIED",
      checks: result.checks,
      totalRepaidBaseUnits: result.totalRepaidBaseUnits,
      remainingBaseUnits: result.remainingBaseUnits,
      blockNumber: transaction.blockNumber,
      blockTimestamp: this.clock.now(),
    };
  }
}
