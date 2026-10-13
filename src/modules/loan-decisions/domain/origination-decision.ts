export const ORIGINATION_DECISION_MODEL_VERSION =
  "loan-decision-manual-review-v1";

export type OriginationDecisionStatus =
  "APPROVAL_CONSIDERATION" | "REVIEW_REQUIRED" | "NOT_ELIGIBLE";

export type RepaymentStructure = "BULLET" | "INSTALLMENT";

export type OriginationDecisionReason =
  | "APPLICATION_INVALID"
  | "APPLICATION_DATA_INCOMPLETE"
  | "EMPLOYEE_INACTIVE"
  | "EMPLOYEE_UNVERIFIED"
  | "IDENTITY_INTEGRITY_UNRESOLVED"
  | "REQUIRED_EVIDENCE_STALE"
  | "FINANCIAL_RECORDS_CONFLICT"
  | "INCOME_UNAVAILABLE"
  | "INCOME_UNVERIFIED"
  | "INCOME_EVIDENCE_STALE"
  | "INCOME_INVALID"
  | "EMPLOYMENT_TENURE_UNAVAILABLE"
  | "EMPLOYER_LOAN_LIMIT_EXCEEDED"
  | "PRODUCT_LOAN_LIMIT_EXCEEDED"
  | "EXPOSURE_LIMIT_EXCEEDED"
  | "NEW_TO_CREDIT"
  | "PRIOR_LATE_REPAYMENT"
  | "PRIOR_DEFAULT"
  | "MANUAL_REVIEW_REQUIRED";

export type OriginationDecisionInput = Readonly<{
  applicationReference: string;
  employee: Readonly<{
    active: boolean;
    verified: boolean;
    identityIntegrityResolved: boolean;
    tenureMonths: number | null;
    statusVerifiedAt: string | null;
  }>;
  application: Readonly<{
    dataComplete: boolean;
    principalMinorUnits: bigint;
    feeMinorUnits: bigint;
    termDays: number;
    repaymentStructure: RepaymentStructure;
    installmentCount?: number;
    policyVersion: number;
    employerLoanLimitMinorUnits: bigint;
    productLoanLimitMinorUnits: bigint;
  }>;
  affordability: Readonly<{
    verifiedNetIncomeMinorUnits: bigint | null;
    incomeVerifiedAt: string | null;
    incomeEvidenceFresh: boolean;
    existingMonthlyObligationsMinorUnits: bigint;
  }>;
  exposure: Readonly<{
    outstandingPrincipalMinorUnits: bigint;
    maximumOutstandingPrincipalMinorUnits: bigint;
  }>;
  repaymentHistory: Readonly<{
    completedOnTimeLoans: number;
    lateLoans: number;
    defaultedLoans: number;
  }>;
  evidence: Readonly<{
    requiredSourceDataFresh: boolean;
    financialRecordsConsistent: boolean;
  }>;
}>;

export type OriginationDecision = Readonly<{
  modelVersion: string;
  status: OriginationDecisionStatus;
  score: null;
  reasonCodes: ReadonlyArray<OriginationDecisionReason>;
  affordability: Readonly<{
    proposedRepaymentMinorUnits: bigint;
    proposedMonthlyObligationMinorUnits: bigint;
    totalMonthlyObligationsMinorUnits: bigint;
    burdenRatioBasisPoints: null;
    maximumBurdenBasisPoints: null;
    maximumPermittedPrincipalMinorUnits: null;
    passed: null;
  }>;
}>;

function ceilDivide(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function proposedMonthlyObligation(
  input: OriginationDecisionInput["application"],
): bigint | null {
  const repayment = input.principalMinorUnits + input.feeMinorUnits;
  if (input.repaymentStructure === "BULLET") return repayment;
  if (
    !input.installmentCount ||
    !Number.isInteger(input.installmentCount) ||
    input.installmentCount <= 0
  ) {
    return null;
  }
  return ceilDivide(repayment, BigInt(input.installmentCount));
}

function addRepaymentHistoryReasons(
  input: OriginationDecisionInput["repaymentHistory"],
  reasons: OriginationDecisionReason[],
): void {
  if (input.defaultedLoans > 0) {
    reasons.push("PRIOR_DEFAULT");
  } else if (input.lateLoans > 0) {
    reasons.push("PRIOR_LATE_REPAYMENT");
  } else if (input.completedOnTimeLoans === 0) {
    reasons.push("NEW_TO_CREDIT");
  }
}

/**
 * Deterministic controlled-pilot rules. This function intentionally has no
 * score, weights, affordability ratio, or automatic approval band. Those
 * values require approved business, risk, and compliance policy that is not
 * present in the repository. Verified hard-gate failures are ineligible; all
 * other applications require an authorized human review.
 */
export function evaluateOriginationDecision(
  input: OriginationDecisionInput,
): OriginationDecision {
  const reasons: OriginationDecisionReason[] = [];
  const repayment =
    input.application.principalMinorUnits + input.application.feeMinorUnits;
  const monthly = proposedMonthlyObligation(input.application);
  const applicationValid =
    input.application.principalMinorUnits > 0n &&
    input.application.feeMinorUnits >= 0n &&
    Number.isInteger(input.application.termDays) &&
    input.application.termDays > 0 &&
    Number.isInteger(input.application.policyVersion) &&
    input.application.policyVersion > 0 &&
    input.application.employerLoanLimitMinorUnits > 0n &&
    input.application.productLoanLimitMinorUnits > 0n &&
    input.exposure.maximumOutstandingPrincipalMinorUnits >= 0n &&
    monthly !== null &&
    input.affordability.existingMonthlyObligationsMinorUnits >= 0n &&
    input.exposure.outstandingPrincipalMinorUnits >= 0n;

  if (!input.application.dataComplete) {
    reasons.push("APPLICATION_DATA_INCOMPLETE");
  }
  if (!applicationValid) reasons.push("APPLICATION_INVALID");
  if (!input.employee.active) reasons.push("EMPLOYEE_INACTIVE");
  if (!input.employee.verified) reasons.push("EMPLOYEE_UNVERIFIED");
  if (!input.employee.identityIntegrityResolved) {
    reasons.push("IDENTITY_INTEGRITY_UNRESOLVED");
  }
  if (!input.evidence.requiredSourceDataFresh) {
    reasons.push("REQUIRED_EVIDENCE_STALE");
  }
  if (!input.evidence.financialRecordsConsistent) {
    reasons.push("FINANCIAL_RECORDS_CONFLICT");
  }
  if (
    input.application.principalMinorUnits >
    input.application.employerLoanLimitMinorUnits
  ) {
    reasons.push("EMPLOYER_LOAN_LIMIT_EXCEEDED");
  }
  if (
    input.application.principalMinorUnits >
    input.application.productLoanLimitMinorUnits
  ) {
    reasons.push("PRODUCT_LOAN_LIMIT_EXCEEDED");
  }

  const projectedExposure =
    input.exposure.outstandingPrincipalMinorUnits +
    input.application.principalMinorUnits;
  if (
    projectedExposure > input.exposure.maximumOutstandingPrincipalMinorUnits
  ) {
    reasons.push("EXPOSURE_LIMIT_EXCEEDED");
  }

  if (input.employee.tenureMonths === null) {
    reasons.push("EMPLOYMENT_TENURE_UNAVAILABLE");
  }

  const income = input.affordability.verifiedNetIncomeMinorUnits;
  if (income === null) {
    reasons.push("INCOME_UNAVAILABLE");
  } else if (!input.affordability.incomeVerifiedAt) {
    reasons.push("INCOME_UNVERIFIED");
  } else if (!input.affordability.incomeEvidenceFresh) {
    reasons.push("INCOME_EVIDENCE_STALE");
  } else if (income <= 0n) {
    reasons.push("INCOME_INVALID");
  }

  addRepaymentHistoryReasons(input.repaymentHistory, reasons);

  const hardGateFailed = reasons.some((reason) =>
    [
      "APPLICATION_INVALID",
      "EMPLOYEE_INACTIVE",
      "EMPLOYER_LOAN_LIMIT_EXCEEDED",
      "PRODUCT_LOAN_LIMIT_EXCEEDED",
      "EXPOSURE_LIMIT_EXCEEDED",
    ].includes(reason),
  );
  if (!hardGateFailed) reasons.push("MANUAL_REVIEW_REQUIRED");

  const totalMonthly =
    input.affordability.existingMonthlyObligationsMinorUnits + (monthly ?? 0n);

  return {
    modelVersion: ORIGINATION_DECISION_MODEL_VERSION,
    status: hardGateFailed ? "NOT_ELIGIBLE" : "REVIEW_REQUIRED",
    score: null,
    reasonCodes: reasons,
    affordability: {
      proposedRepaymentMinorUnits: repayment,
      proposedMonthlyObligationMinorUnits: monthly ?? 0n,
      totalMonthlyObligationsMinorUnits: totalMonthly,
      burdenRatioBasisPoints: null,
      maximumBurdenBasisPoints: null,
      maximumPermittedPrincipalMinorUnits: null,
      passed: null,
    },
  };
}
