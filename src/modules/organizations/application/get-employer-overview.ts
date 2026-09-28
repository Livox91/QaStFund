import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { EmployerOverviewRepository } from "@/modules/organizations/application/ports/employer-overview-repository";
import {
  EmployerOverviewLoanStatus,
  type EmployerOverview,
  type EmployerOverviewLoan,
  type LoanAttention,
} from "@/modules/organizations/domain/employer-overview";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const REPAYMENT_DUE_WINDOW_DAYS = 7;
const ATTENTION_WINDOW_DAYS = 3;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_IN_MILLISECONDS);
}

export function describeLoanAttention(
  loan: Pick<EmployerOverviewLoan, "repaymentDueAt" | "status">,
  now: Date,
): LoanAttention {
  if (
    loan.status === EmployerOverviewLoanStatus.OVERDUE ||
    loan.repaymentDueAt < now
  ) {
    const days = Math.max(
      1,
      Math.floor(
        (now.getTime() - loan.repaymentDueAt.getTime()) / DAY_IN_MILLISECONDS,
      ),
    );

    return {
      kind: "OVERDUE",
      label: `Overdue by ${days} ${days === 1 ? "day" : "days"}`,
    };
  }

  const days = Math.max(
    0,
    Math.ceil(
      (loan.repaymentDueAt.getTime() - now.getTime()) / DAY_IN_MILLISECONDS,
    ),
  );

  return {
    kind: "DUE_SOON",
    label:
      days === 0
        ? "Due today"
        : `Due in ${days} ${days === 1 ? "day" : "days"}`,
  };
}

export async function getEmployerOverview(
  actor: AuthenticatedActor | null,
  repository: EmployerOverviewRepository,
  now = new Date(),
): Promise<EmployerOverview> {
  const employerAdmin = requireEmployerAdmin(actor);
  const result = await repository.loadForOrganization({
    organizationId: employerAdmin.organizationId,
    now,
    dueWindowEndsAt: addDays(now, REPAYMENT_DUE_WINDOW_DAYS),
    attentionWindowEndsAt: addDays(now, ATTENTION_WINDOW_DAYS),
  });

  return {
    ...result,
    loansRequiringAttention: result.loansRequiringAttention.map((loan) => ({
      ...loan,
      attention: describeLoanAttention(loan, now),
    })),
    generatedAt: now,
  };
}
