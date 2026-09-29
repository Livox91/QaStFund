import type { EmployerLoanStatus } from "@/modules/loans/domain/employer-loan";

export function shouldMarkLoanOverdue(input: {
  status: EmployerLoanStatus;
  dueAt: Date;
  remainingBalanceMinorUnits: bigint;
  now: Date;
}): boolean {
  return (
    input.status === "ACTIVE" &&
    input.dueAt.getTime() < input.now.getTime() &&
    input.remainingBalanceMinorUnits > 0n
  );
}
