export const ORIGINATION_DECISION_MODEL_VERSION = "loan-decision-rules-v1";

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
  | "AFFORDABILITY_EXCEEDED"
  | "EMPLOYER_LOAN_LIMIT_EXCEEDED"
  | "PRODUCT_LOAN_LIMIT_EXCEEDED"
  | "EXPOSURE_LIMIT_EXCEEDED"
  | "NEW_TO_CREDIT"
  | "PRIOR_LATE_REPAYMENT"
  | "PRIOR_DEFAULT"
  | "SCORE_APPROVAL_BAND"
  | "SCORE_REVIEW_BAND"
  | "SCORE_LOW_BAND";

export type OriginationDecisionConfig = Readonly<{
  version: string;
  weights: Readonly<{
    repaymentHistory: number;
    affordability: number;
    employmentStability: number;
    existingExposure: number;
  }>;
  approvalScore: number;
  reviewScore: number;
  maximumBurdenBasisPoints: number;
}>;

export const ORIGINATION_DECISION_CONFIG_V1: OriginationDecisionConfig =
  Object.freeze({
    version: ORIGINATION_DECISION_MODEL_VERSION,
    weights: Object.freeze({
      repaymentHistory: 35,
      affordability: 30,
      employmentStability: 20,
      existingExposure: 15,
    }),
    approvalScore: 75,
    reviewScore: 55,
    maximumBurdenBasisPoints: 4_000,
  });

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
  score: number | null;
  reasonCodes: ReadonlyArray<OriginationDecisionReason>;
  featureScores: Readonly<{
    repaymentHistory: number;
    affordability: number | null;
    employmentStability: number | null;
    existingExposure: number;
  }>;
  affordability: Readonly<{
    proposedRepaymentMinorUnits: bigint;
    proposedMonthlyObligationMinorUnits: bigint;
    totalMonthlyObligationsMinorUnits: bigint;
    burdenRatioBasisPoints: number | null;
    maximumBurdenBasisPoints: number;
    maximumPermittedPrincipalMinorUnits: bigint | null;
    passed: boolean | null;
  }>;
}>;

export function validateOriginationDecisionConfig(
  config: OriginationDecisionConfig,
): void {
  const weightTotal = Object.values(config.weights).reduce(
    (total, weight) => total + weight,
    0,
  );
  if (
    !config.version.trim() ||
    weightTotal !== 100 ||
    !Object.values(config.weights).every(
      (weight) => Number.isInteger(weight) && weight >= 0,
    ) ||
    !Number.isInteger(config.approvalScore) ||
    !Number.isInteger(config.reviewScore) ||
    config.approvalScore <= config.reviewScore ||
    config.approvalScore > 100 ||
    config.reviewScore < 0 ||
    !Number.isInteger(config.maximumBurdenBasisPoints) ||
    config.maximumBurdenBasisPoints <= 0 ||
    config.maximumBurdenBasisPoints > 10_000
  ) {
    throw new Error("Invalid origination decision configuration.");
  }
}

validateOriginationDecisionConfig(ORIGINATION_DECISION_CONFIG_V1);

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

function repaymentHistoryScore(
  input: OriginationDecisionInput["repaymentHistory"],
  reasons: OriginationDecisionReason[],
): number {
  if (input.defaultedLoans > 0) {
    reasons.push("PRIOR_DEFAULT");
    return 0;
  }
  if (input.lateLoans > 0) {
    reasons.push("PRIOR_LATE_REPAYMENT");
    return 15;
  }
  if (input.completedOnTimeLoans === 0) {
    reasons.push("NEW_TO_CREDIT");
    return 25;
  }
  return 35;
}

function employmentStabilityScore(tenureMonths: number): number {
  if (tenureMonths >= 24) return 20;
  if (tenureMonths >= 12) return 15;
  if (tenureMonths >= 6) return 10;
  return 5;
}

function exposureScore(projected: bigint, maximum: bigint): number {
  if (maximum <= 0n || projected > maximum) return 0;
  const ratio = Number((projected * 10_000n) / maximum);
  if (ratio <= 2_500) return 15;
  if (ratio <= 5_000) return 10;
  if (ratio <= 7_500) return 5;
  return 0;
}

function affordabilityScore(burdenBasisPoints: number): number {
  if (burdenBasisPoints <= 2_000) return 30;
  if (burdenBasisPoints <= 3_000) return 24;
  if (burdenBasisPoints <= 4_000) return 12;
  return 0;
}

export function evaluateOriginationDecision(
  input: OriginationDecisionInput,
  config: OriginationDecisionConfig = ORIGINATION_DECISION_CONFIG_V1,
): OriginationDecision {
  validateOriginationDecisionConfig(config);
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

  const historyScore = repaymentHistoryScore(input.repaymentHistory, reasons);
  const stabilityScore =
    input.employee.tenureMonths === null
      ? null
      : employmentStabilityScore(input.employee.tenureMonths);
  if (stabilityScore === null) {
    reasons.push("EMPLOYMENT_TENURE_UNAVAILABLE");
  }

  const income = input.affordability.verifiedNetIncomeMinorUnits;
  let burdenRatioBasisPoints: number | null = null;
  let affordabilityPassed: boolean | null = null;
  let calculatedAffordabilityScore: number | null = null;
  let maximumPermittedPrincipalMinorUnits: bigint | null = null;
  const totalMonthly =
    input.affordability.existingMonthlyObligationsMinorUnits + (monthly ?? 0n);
  if (income === null) {
    reasons.push("INCOME_UNAVAILABLE");
  } else if (!input.affordability.incomeVerifiedAt) {
    reasons.push("INCOME_UNVERIFIED");
  } else if (!input.affordability.incomeEvidenceFresh) {
    reasons.push("INCOME_EVIDENCE_STALE");
  } else if (income <= 0n) {
    reasons.push("INCOME_INVALID");
    affordabilityPassed = false;
  } else if (
    monthly !== null &&
    applicationValid &&
    input.application.dataComplete &&
    input.evidence.requiredSourceDataFresh &&
    input.evidence.financialRecordsConsistent
  ) {
    burdenRatioBasisPoints = Number(ceilDivide(totalMonthly * 10_000n, income));
    affordabilityPassed =
      burdenRatioBasisPoints <= config.maximumBurdenBasisPoints;
    calculatedAffordabilityScore = affordabilityScore(burdenRatioBasisPoints);
    const permittedTotalMonthly =
      (income * BigInt(config.maximumBurdenBasisPoints)) / 10_000n;
    const permittedProposedMonthly =
      permittedTotalMonthly >
      input.affordability.existingMonthlyObligationsMinorUnits
        ? permittedTotalMonthly -
          input.affordability.existingMonthlyObligationsMinorUnits
        : 0n;
    const supportedRepayment =
      input.application.repaymentStructure === "INSTALLMENT"
        ? permittedProposedMonthly * BigInt(input.application.installmentCount!)
        : permittedProposedMonthly;
    maximumPermittedPrincipalMinorUnits =
      supportedRepayment > input.application.feeMinorUnits
        ? supportedRepayment - input.application.feeMinorUnits
        : 0n;
    if (!affordabilityPassed) reasons.push("AFFORDABILITY_EXCEEDED");
  }

  const calculatedExposureScore = exposureScore(
    projectedExposure,
    input.exposure.maximumOutstandingPrincipalMinorUnits,
  );
  const score =
    stabilityScore === null || calculatedAffordabilityScore === null
      ? null
      : historyScore +
        stabilityScore +
        calculatedAffordabilityScore +
        calculatedExposureScore;

  const policyIneligibility = reasons.some((reason) =>
    [
      "APPLICATION_INVALID",
      "EMPLOYEE_INACTIVE",
      "AFFORDABILITY_EXCEEDED",
      "EMPLOYER_LOAN_LIMIT_EXCEEDED",
      "PRODUCT_LOAN_LIMIT_EXCEEDED",
      "EXPOSURE_LIMIT_EXCEEDED",
    ].includes(reason),
  );
  const insufficientEvidence = reasons.some((reason) =>
    [
      "EMPLOYEE_UNVERIFIED",
      "IDENTITY_INTEGRITY_UNRESOLVED",
      "REQUIRED_EVIDENCE_STALE",
      "FINANCIAL_RECORDS_CONFLICT",
      "APPLICATION_DATA_INCOMPLETE",
      "INCOME_UNAVAILABLE",
      "INCOME_UNVERIFIED",
      "INCOME_EVIDENCE_STALE",
      "INCOME_INVALID",
      "EMPLOYMENT_TENURE_UNAVAILABLE",
      "NEW_TO_CREDIT",
    ].includes(reason),
  );
  let status: OriginationDecisionStatus;
  if (policyIneligibility) {
    status = "NOT_ELIGIBLE";
  } else if (insufficientEvidence || score === null) {
    status = "REVIEW_REQUIRED";
  } else if (score >= config.approvalScore) {
    status = "APPROVAL_CONSIDERATION";
    reasons.push("SCORE_APPROVAL_BAND");
  } else if (score >= config.reviewScore) {
    status = "REVIEW_REQUIRED";
    reasons.push("SCORE_REVIEW_BAND");
  } else {
    status = "NOT_ELIGIBLE";
    reasons.push("SCORE_LOW_BAND");
  }

  return {
    modelVersion: config.version,
    status,
    score,
    reasonCodes: reasons,
    featureScores: {
      repaymentHistory: historyScore,
      affordability: calculatedAffordabilityScore,
      employmentStability: stabilityScore,
      existingExposure: calculatedExposureScore,
    },
    affordability: {
      proposedRepaymentMinorUnits: repayment,
      proposedMonthlyObligationMinorUnits: monthly ?? 0n,
      totalMonthlyObligationsMinorUnits: totalMonthly,
      burdenRatioBasisPoints,
      maximumBurdenBasisPoints: config.maximumBurdenBasisPoints,
      maximumPermittedPrincipalMinorUnits,
      passed: affordabilityPassed,
    },
  };
}
