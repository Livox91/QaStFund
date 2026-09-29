import type { Prisma } from "@/generated/prisma/client";
import {
  DEFAULT_LENDING_POLICY,
  OBLIGATION_LOAN_STATUSES,
  type LendingPolicy,
} from "@/modules/policies/domain/lending-policy";

export type TransactionClient = Prisma.TransactionClient;

export async function ensureOrganizationPolicy(
  transaction: TransactionClient,
  organizationId: string,
): Promise<LendingPolicy> {
  return transaction.organizationLendingPolicy.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId, ...DEFAULT_LENDING_POLICY },
  });
}

export async function calculateBorrowerObligations(
  transaction: TransactionClient,
  organizationId: string,
  borrowerMembershipId: string,
) {
  const loans = await transaction.loan.findMany({
    where: {
      organizationId,
      borrowerMembershipId,
      status: { in: [...OBLIGATION_LOAN_STATUSES] },
    },
    select: {
      principalAmountMinorUnits: true,
      feeAmountMinorUnits: true,
      repayments: {
        where: { status: "COMPLETED" },
        select: { amountMinorUnits: true },
      },
    },
  });
  return {
    activeLoans: loans.length,
    outstandingDebtMinorUnits: loans.reduce((total, loan) => {
      const agreed = loan.principalAmountMinorUnits + loan.feeAmountMinorUnits;
      const repaid = loan.repayments.reduce(
        (sum, repayment) => sum + repayment.amountMinorUnits,
        0n,
      );
      return total + (repaid < agreed ? agreed - repaid : 0n);
    }, 0n),
  };
}
