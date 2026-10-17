import type {
  MandateSnapshot,
  ObligationView,
} from "@/modules/repayment-agent/domain/agent-policy";

export const REPAYMENT_AGENT_PROMPT_VERSION = "repayment-agent-prompt-v1";

export type ReconciliationHealth = Readonly<{
  healthy: boolean;
  lastSuccessfulAt: Date | null;
  reasonCode: string | null;
}>;

export type InFlightOperation = Readonly<{
  actionId: string;
  loanId: string;
  amountBaseUnits: bigint;
  transactionHash: string | null;
  submittedAt: Date | null;
}>;

export type PendingApproval = Readonly<{
  actionId: string;
  loanId: string;
  amountBaseUnits: bigint;
  expiresAt: Date;
}>;

/** Everything the agent knew when it decided. Persisted with every run. */
export type RepaymentObservation = Readonly<{
  observedAt: Date;
  borrowerWalletAddress: string;
  walletBalanceBaseUnits: bigint;
  allowanceBaseUnits: bigint;
  mandate: MandateSnapshot | null;
  obligations: ReadonlyArray<ObligationView>;
  reconciliation: ReconciliationHealth;
  inFlight: InFlightOperation | null;
  pendingApprovals: ReadonlyArray<PendingApproval>;
  /** Confirmed agent payments inside the spacing window, per loan. */
  recentPayments: ReadonlyArray<Readonly<{ loanId: string; at: Date }>>;
  recentFailures: ReadonlyArray<Readonly<{ code: string; at: Date }>>;
}>;

export type AgentPhase =
  | "OBSERVE"
  | "REASON"
  | "TOOL"
  | "VALIDATE"
  | "ACT"
  | "VERIFY"
  | "ADAPT"
  | "EXPLAIN";

export type AgentStep = Readonly<{
  phase: AgentPhase;
  name: string;
  summary: string;
  data: unknown;
}>;

export type AgentRunStatus =
  | "COMPLETED"
  | "WAITING"
  | "AWAITING_APPROVAL"
  | "ESCALATED"
  | "STOPPED"
  | "FAILED";

export type AgentTrigger = "SCHEDULED" | "MANUAL" | "APPROVAL_FOLLOW_UP";

export type PolicyCheck = Readonly<{
  code: string;
  passed: boolean;
  detail: string;
}>;

/** Converts bigint and Date values so snapshots can be stored as JSON. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]),
    );
  }
  return value;
}
