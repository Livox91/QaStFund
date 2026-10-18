import { keccak256, stringToHex } from "viem";

/**
 * EmployeeLendingEscrowV3 additions. V3 keeps the V1 offer, acceptance and
 * `loans()` interface byte-compatible, so `employeeLendingEscrowAbi` remains
 * valid against a V3 deployment; this ABI adds partial repayment and the
 * borrower-granted repayment mandate.
 */
export const escrowV3Abi = [
  {
    type: "function",
    name: "repaidAmounts",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "usedRepaymentIds",
    stateMutability: "view",
    inputs: [{ name: "repaymentId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "repayLoanPartial",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "repaymentId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setRepaymentMandate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "maxPerRepayment", type: "uint256" },
      { name: "maxPerPeriod", type: "uint256" },
      { name: "minimumReserve", type: "uint256" },
      { name: "periodSeconds", type: "uint256" },
      { name: "earliestBeforeDueSeconds", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
  {
    type: "function",
    name: "revokeRepaymentMandate",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "repayOnBehalf",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "repaymentId", type: "bytes32" },
      { name: "mandateNonce", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repaymentMandates",
    stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [
      { name: "agent", type: "address" },
      { name: "maxPerRepayment", type: "uint256" },
      { name: "maxPerPeriod", type: "uint256" },
      { name: "minimumReserve", type: "uint256" },
      { name: "periodSeconds", type: "uint256" },
      { name: "earliestBeforeDueSeconds", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "periodStart", type: "uint256" },
      { name: "spentInPeriod", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "event",
    name: "LoanRepaymentReceived",
    anonymous: false,
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "repaymentId", type: "bytes32" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: false, name: "lender", type: "address" },
      { indexed: false, name: "payer", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "totalRepaid", type: "uint256" },
      { indexed: false, name: "remaining", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "LoanRepaid",
    anonymous: false,
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: true, name: "lender", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "repaidAt", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "RepaymentMandateSet",
    anonymous: false,
    inputs: [
      { indexed: true, name: "borrower", type: "address" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: true, name: "nonce", type: "uint256" },
      { indexed: false, name: "maxPerRepayment", type: "uint256" },
      { indexed: false, name: "maxPerPeriod", type: "uint256" },
      { indexed: false, name: "minimumReserve", type: "uint256" },
      { indexed: false, name: "periodSeconds", type: "uint256" },
      { indexed: false, name: "earliestBeforeDueSeconds", type: "uint256" },
      { indexed: false, name: "expiresAt", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "RepaymentMandateRevoked",
    anonymous: false,
    inputs: [
      { indexed: true, name: "borrower", type: "address" },
      { indexed: true, name: "nonce", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "AgentRepaymentExecuted",
    anonymous: false,
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "repaymentId", type: "bytes32" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: false, name: "borrower", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "mandateNonce", type: "uint256" },
      { indexed: false, name: "spentInPeriod", type: "uint256" },
    ],
  },
  ...[
    "DuplicateRepayment",
    "InvalidLoan",
    "InvalidMandate",
    "InvalidRepayment",
    "LoanNotActive",
    "MandateChanged",
    "MandateExpired",
    "MandateNotActive",
    "NotLoanBorrower",
    "NotMandateAgent",
    "PeriodCapExceeded",
    "RepaymentCapExceeded",
    "RepaymentExceedsOutstanding",
    "RepaymentWindowNotOpen",
    "ReserveViolation",
    "ZeroAddress",
  ].map((name) => ({ type: "error" as const, name, inputs: [] })),
] as const;

export const erc20AllowanceAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Escrow revert reasons that are deterministic: retrying cannot succeed. */
export const NON_RETRYABLE_ESCROW_ERRORS: ReadonlySet<string> = new Set([
  "DuplicateRepayment",
  "InvalidLoan",
  "InvalidRepayment",
  "LoanNotActive",
  "MandateChanged",
  "MandateExpired",
  "MandateNotActive",
  "NotMandateAgent",
  "PeriodCapExceeded",
  "RepaymentCapExceeded",
  "RepaymentExceedsOutstanding",
  "RepaymentWindowNotOpen",
  "ReserveViolation",
]);

export type EscrowVersion = "1" | "3";

/** Server-side escrow capability flag; V1 deployments have no mandate. */
export function getConfiguredEscrowVersion(): EscrowVersion {
  return process.env.ARC_ESCROW_VERSION === "3" ? "3" : "1";
}

/**
 * Deterministic on-chain repayment identifier. Retrying with the same
 * identifier is at-most-once: the escrow rejects a second use, and a reverted
 * attempt never consumes it.
 */
export function agentRepaymentIdToBytes32(repaymentRequestId: string) {
  return keccak256(stringToHex(`agent-repayment:${repaymentRequestId}`));
}

/** Deterministic id used by borrower-signed partial repayments. */
export function borrowerRepaymentIdToBytes32(repaymentRequestId: string) {
  return keccak256(stringToHex(`borrower-repayment:${repaymentRequestId}`));
}
