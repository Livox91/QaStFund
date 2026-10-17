import type {
  BorrowerProfile,
  BorrowerRef,
  ReconciliationHealthReader,
  RepaymentAgentRepository,
  RepaymentChainGateway,
  StoredObligation,
} from "@/modules/repayment-agent/application/ports";
import type {
  AgentPolicyConfig,
  ObligationView,
} from "@/modules/repayment-agent/domain/agent-policy";
import type { RepaymentObservation } from "@/modules/repayment-agent/domain/agent-run";

const DAY_MS = 86_400_000;

function same(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export type ObservationResult = Readonly<{
  observation: RepaymentObservation;
  obligationsByLoanId: ReadonlyMap<string, StoredObligation>;
  integrityIssues: ReadonlyArray<{ loanId: string; code: string }>;
}>;

/**
 * Builds the agent's view from the database and authoritative chain reads.
 * On-chain repaid amounts and the live wallet balance always win over stored
 * values; a loan whose on-chain parties disagree with the database is excluded
 * from agent action.
 */
export async function observeBorrower(input: {
  borrower: BorrowerRef;
  profile: BorrowerProfile & { walletAddress: string };
  repository: RepaymentAgentRepository;
  gateway: RepaymentChainGateway;
  reconciliation: ReconciliationHealthReader;
  policy: AgentPolicyConfig;
  now: Date;
}): Promise<ObservationResult> {
  const { borrower, profile, repository, gateway, now } = input;
  const [stored, chainState, health, inFlight, approvals, payments, failures] =
    await Promise.all([
      repository.listObligations(borrower),
      gateway.readBorrowerState(profile.walletAddress),
      input.reconciliation.read(now),
      repository.findInFlight(borrower),
      repository.listPendingApprovals(borrower),
      repository.listRecentPayments(
        borrower,
        new Date(now.getTime() - input.policy.paymentSpacingMs),
      ),
      repository.listRecentFailures(borrower, new Date(now.getTime() - DAY_MS)),
    ]);

  const integrityIssues: Array<{ loanId: string; code: string }> = [];
  const sorted = [...stored].sort(
    (left, right) => left.dueAt.getTime() - right.dueAt.getTime(),
  );
  const obligations: ObligationView[] = [];
  for (const [index, obligation] of sorted.entries()) {
    const onMandateEscrow =
      obligation.agentEligible &&
      same(obligation.contractAddress, gateway.contractAddress);
    let repaid = 0n;
    let outstanding = obligation.repaymentBaseUnits;
    let agentEligible = onMandateEscrow;
    let dueAt = obligation.dueAt;
    if (onMandateEscrow) {
      const loan = await gateway.readLoan(obligation.chainLoanId);
      if (
        !same(loan.borrower, profile.walletAddress) ||
        !same(loan.lender, obligation.lenderWalletAddress) ||
        loan.repaymentAmountBaseUnits !== obligation.repaymentBaseUnits
      ) {
        integrityIssues.push({
          loanId: obligation.loanId,
          code: "CHAIN_PARTIES_MISMATCH",
        });
        agentEligible = false;
      }
      repaid = loan.repaidBaseUnits;
      outstanding = loan.active ? loan.repaymentAmountBaseUnits - repaid : 0n;
      dueAt = loan.dueAt;
    }
    obligations.push({
      ref: `L${index + 1}`,
      loanId: obligation.loanId,
      chainLoanId: obligation.chainLoanId,
      contractAddress: obligation.contractAddress,
      dueAt,
      repaymentBaseUnits: obligation.repaymentBaseUnits,
      repaidBaseUnits: repaid,
      outstandingBaseUnits: outstanding,
      agentEligible,
    });
  }

  return {
    observation: {
      observedAt: now,
      borrowerWalletAddress: profile.walletAddress,
      walletBalanceBaseUnits: chainState.walletBalanceBaseUnits,
      allowanceBaseUnits: chainState.allowanceBaseUnits,
      mandate: chainState.mandate,
      obligations,
      reconciliation: health,
      inFlight,
      pendingApprovals: approvals,
      recentPayments: payments,
      recentFailures: failures,
    },
    obligationsByLoanId: new Map(stored.map((item) => [item.loanId, item])),
    integrityIssues,
  };
}
