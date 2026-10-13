import { OriginationDecisionReviewForm } from "@/modules/loan-decisions/ui/origination-decision-review-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { StatusDisplay } from "@/shared/ui/status-display";

const reasonLabels: Record<string, string> = {
  APPLICATION_INVALID: "The request contains invalid terms.",
  APPLICATION_DATA_INCOMPLETE:
    "The application data required by this model is incomplete.",
  EMPLOYEE_INACTIVE: "The employee is not currently eligible to borrow.",
  EMPLOYEE_UNVERIFIED: "Current employee status could not be verified.",
  IDENTITY_INTEGRITY_UNRESOLVED: "The employee identity mapping is unresolved.",
  REQUIRED_EVIDENCE_STALE: "Required source evidence is stale or incomplete.",
  FINANCIAL_RECORDS_CONFLICT:
    "Existing financial records require reconciliation.",
  INCOME_UNAVAILABLE: "Verified net income evidence is unavailable.",
  INCOME_UNVERIFIED: "Income evidence has not been verified.",
  INCOME_EVIDENCE_STALE: "Verified income evidence is stale.",
  INCOME_INVALID: "The supplied income evidence is invalid.",
  EMPLOYMENT_TENURE_UNAVAILABLE: "Verified employment tenure is unavailable.",
  AFFORDABILITY_EXCEEDED: "The configured affordability limit was exceeded.",
  EMPLOYER_LOAN_LIMIT_EXCEEDED: "The employer loan limit was exceeded.",
  PRODUCT_LOAN_LIMIT_EXCEEDED: "The offer limit was exceeded.",
  EXPOSURE_LIMIT_EXCEEDED: "The employee exposure limit was exceeded.",
  NEW_TO_CREDIT: "No completed repayment history is available.",
  PRIOR_LATE_REPAYMENT: "Prior late repayment was identified.",
  PRIOR_DEFAULT: "A prior default was identified.",
  MANUAL_REVIEW_REQUIRED:
    "Controlled-pilot policy requires an authorized human review.",
  SCORE_APPROVAL_BAND:
    "The calculated score is in the approval-consideration band.",
  SCORE_REVIEW_BAND: "The calculated score requires manual review.",
  SCORE_LOW_BAND: "The calculated score is below the review threshold.",
};

export type EmployerOriginationDecisionView = {
  id: string;
  modelVersion: string;
  status: string;
  score: number | null;
  reasonCodes: string[];
  evaluatedAt: Date;
  override: {
    outcome: string;
    rationale: string;
    reviewedAt: Date;
    reviewedByMembership: { user: { name: string } };
  } | null;
};

export function EmployerOriginationDecision({
  decision,
}: {
  decision: EmployerOriginationDecisionView;
}) {
  const pending = decision.status === "REVIEW_REQUIRED" && !decision.override;
  const displayStatus = decision.override?.outcome ?? decision.status;

  return (
    <Card className="mt-8 border-amber-200">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Origination eligibility review</CardTitle>
            <CardDescription>
              Review required evidence without changing the requested financial
              terms.
            </CardDescription>
          </div>
          <StatusDisplay status={displayStatus} />
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              Model
            </dt>
            <dd className="mt-1 text-sm font-semibold text-slate-950">
              {decision.modelVersion}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              Score
            </dt>
            <dd className="mt-1 text-sm font-semibold text-slate-950">
              {decision.score ?? "Not calculated"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              Evaluated
            </dt>
            <dd className="mt-1 text-sm font-semibold text-slate-950">
              {decision.evaluatedAt.toLocaleString("en-US")}
            </dd>
          </div>
        </dl>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-950">
            Decision reasons
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
            {decision.reasonCodes.map((reason) => (
              <li key={reason}>{reasonLabels[reason] ?? reason}</li>
            ))}
          </ul>
        </div>

        {decision.override ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            <p className="font-semibold text-slate-950">
              {decision.override.outcome === "APPROVED"
                ? "Approved"
                : "Rejected"}{" "}
              by {decision.override.reviewedByMembership.user.name}
            </p>
            <p className="mt-1">{decision.override.rationale}</p>
            <p className="mt-2 text-xs text-slate-500">
              {decision.override.reviewedAt.toLocaleString("en-US")}
            </p>
          </div>
        ) : null}

        {pending ? (
          <OriginationDecisionReviewForm decisionId={decision.id} />
        ) : null}
      </CardContent>
    </Card>
  );
}
