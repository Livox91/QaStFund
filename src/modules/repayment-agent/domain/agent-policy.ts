import { USDC_BASE_UNITS_PER_CENT } from "@/shared/money/usdc";

/** Version of the deterministic boundary the planner's output is checked against. */
export const REPAYMENT_AGENT_POLICY_VERSION = "repayment-agent-policy-v1";

export const ONE_USDC = 1_000_000n;
const HOUR_MS = 3_600_000;

/**
 * Fixed limits that no planner, model or user mandate can loosen. The user's
 * mandate narrows these further; the escrow contract enforces the mandate.
 */
export type AgentPolicyConfig = Readonly<{
  /** Smallest partial repayment worth a transaction. */
  minimumPartialBaseUnits: bigint;
  /** Actions (pay, approval, notification) one run may take before stopping. */
  maxActionsPerRun: number;
  /** Plans the validator may reject in one run before the agent escalates. */
  maxRejectedPlansPerRun: number;
  /** Retries of the same on-chain repayment id after a transient failure. */
  maxSafeRetries: number;
  /** A due date within this window counts as "due soon". */
  dueSoonMs: number;
  /** Passkey approval requests expire after this long. */
  approvalTtlMs: number;
  /** How long the agent waits for a receipt before monitoring later. */
  receiptTimeoutMs: number;
  /** Minimum gap between two agent payments on the same loan. */
  paymentSpacingMs: number;
  /** A signed transaction the node never saw is treated as dropped after this. */
  droppedAfterMs: number;
}>;

export const DEFAULT_AGENT_POLICY: AgentPolicyConfig = Object.freeze({
  minimumPartialBaseUnits: ONE_USDC,
  maxActionsPerRun: 3,
  maxRejectedPlansPerRun: 2,
  maxSafeRetries: 1,
  dueSoonMs: 72 * HOUR_MS,
  approvalTtlMs: 48 * HOUR_MS,
  receiptTimeoutMs: 60_000,
  paymentSpacingMs: 1 * HOUR_MS,
  droppedAfterMs: 10 * 60_000,
});

/** On-chain mandate as read from `repaymentMandates(borrower)`. */
export type MandateSnapshot = Readonly<{
  agentAddress: string;
  maxPerRepaymentBaseUnits: bigint;
  maxPerPeriodBaseUnits: bigint;
  minimumReserveBaseUnits: bigint;
  periodSeconds: number;
  earliestBeforeDueSeconds: number;
  expiresAt: Date;
  periodStartedAt: Date;
  spentInPeriodBaseUnits: bigint;
  nonce: bigint;
  active: boolean;
}>;

export type ObligationView = Readonly<{
  /** Pseudonymous reference shown to the planner instead of ids or names. */
  ref: string;
  loanId: string;
  chainLoanId: string;
  contractAddress: string;
  dueAt: Date;
  repaymentBaseUnits: bigint;
  repaidBaseUnits: bigint;
  outstandingBaseUnits: bigint;
  /** Loan lives on the configured mandate-capable escrow. */
  agentEligible: boolean;
}>;

export type MandateCheckedConstraint =
  "OUTSTANDING" | "PER_REPAYMENT_CAP" | "PERIOD_CAP" | "RESERVE" | "ALLOWANCE";

export type RepaymentCapacity = Readonly<{
  /** Largest amount the mandate allows the agent to pay right now. */
  payableNowBaseUnits: bigint;
  limits: Readonly<Record<MandateCheckedConstraint, bigint>>;
  bindingConstraint: MandateCheckedConstraint;
  windowOpen: boolean;
  windowOpensAt: Date | null;
}>;

export function isMandateUsable(
  mandate: MandateSnapshot | null,
  agentAddress: string,
  now: Date,
): mandate is MandateSnapshot {
  return (
    mandate !== null &&
    mandate.active &&
    mandate.agentAddress.toLowerCase() === agentAddress.toLowerCase() &&
    mandate.expiresAt.getTime() >= now.getTime()
  );
}

/** Mirrors the escrow's rolling-period reset. */
export function periodRemainingBaseUnits(
  mandate: MandateSnapshot,
  now: Date,
): bigint {
  const periodEndsAt =
    mandate.periodStartedAt.getTime() + mandate.periodSeconds * 1_000;
  if (now.getTime() >= periodEndsAt) return mandate.maxPerPeriodBaseUnits;
  const remaining =
    mandate.maxPerPeriodBaseUnits - mandate.spentInPeriodBaseUnits;
  return remaining > 0n ? remaining : 0n;
}

function clampToZero(value: bigint) {
  return value > 0n ? value : 0n;
}

/** Mirrors `repayOnBehalf` checks so plans can be validated before submission. */
export function computeRepaymentCapacity(input: {
  mandate: MandateSnapshot;
  obligation: ObligationView;
  walletBalanceBaseUnits: bigint;
  allowanceBaseUnits: bigint;
  now: Date;
}): RepaymentCapacity {
  const { mandate, obligation, now } = input;
  const limits: Record<MandateCheckedConstraint, bigint> = {
    OUTSTANDING: obligation.outstandingBaseUnits,
    PER_REPAYMENT_CAP: mandate.maxPerRepaymentBaseUnits,
    PERIOD_CAP: periodRemainingBaseUnits(mandate, now),
    RESERVE: clampToZero(
      input.walletBalanceBaseUnits - mandate.minimumReserveBaseUnits,
    ),
    ALLOWANCE: input.allowanceBaseUnits,
  };
  let bindingConstraint: MandateCheckedConstraint = "OUTSTANDING";
  for (const [key, value] of Object.entries(limits) as Array<
    [MandateCheckedConstraint, bigint]
  >) {
    if (value < limits[bindingConstraint]) bindingConstraint = key;
  }
  const windowOpensAt = new Date(
    obligation.dueAt.getTime() - mandate.earliestBeforeDueSeconds * 1_000,
  );
  const windowOpen = now.getTime() >= windowOpensAt.getTime();
  return {
    payableNowBaseUnits: windowOpen ? limits[bindingConstraint] : 0n,
    limits,
    bindingConstraint,
    windowOpen,
    windowOpensAt: windowOpen ? null : windowOpensAt,
  };
}

/**
 * Partial repayments are whole cents so application records (integer cents)
 * stay exact; only the final remainder may carry sub-cent interest rounding.
 */
export function isCentAligned(amountBaseUnits: bigint): boolean {
  return amountBaseUnits % USDC_BASE_UNITS_PER_CENT === 0n;
}

export function roundDownToCent(amountBaseUnits: bigint): bigint {
  return amountBaseUnits - (amountBaseUnits % USDC_BASE_UNITS_PER_CENT);
}

export function hoursUntil(date: Date, now: Date): number {
  return Math.round(((date.getTime() - now.getTime()) / HOUR_MS) * 10) / 10;
}
