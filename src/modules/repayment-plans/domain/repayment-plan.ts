export const SUPPORTED_REPAYMENT_TERM_MONTHS = [1, 2, 3] as const;

export type SupportedRepaymentTermMonths =
  (typeof SUPPORTED_REPAYMENT_TERM_MONTHS)[number];

export type InstallmentState =
  | "UPCOMING"
  | "DUE"
  | "PAYMENT_PENDING"
  | "OVERDUE"
  | "PARTIALLY_PAID"
  | "RESOLVED";

export type ScheduledInstallment = Readonly<{
  sequence: number;
  amountMinorUnits: bigint;
  dueAt: Date;
}>;

function assertPositiveAmount(amountMinorUnits: bigint) {
  if (amountMinorUnits <= 0n) {
    throw new Error("Repayment total must be positive.");
  }
}

function assertSupportedTerm(
  termMonths: number,
): asserts termMonths is SupportedRepaymentTermMonths {
  if (
    !SUPPORTED_REPAYMENT_TERM_MONTHS.includes(
      termMonths as SupportedRepaymentTermMonths,
    )
  ) {
    throw new Error("Repayment term must be one, two, or three months.");
  }
}

/**
 * Adds calendar months in UTC while retaining the original day where possible.
 * The day is clamped to the destination month's final day (31 Jan -> 28/29 Feb).
 */
export function addUtcCalendarMonths(date: Date, months: number): Date {
  if (!Number.isSafeInteger(months)) {
    throw new Error("Calendar month offset must be an integer.");
  }

  const result = new Date(date.getTime());
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const finalDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, finalDay));
  return result;
}

export function generateRepaymentSchedule(
  input: Readonly<{
    totalRepaymentMinorUnits: bigint;
    termMonths: number;
    originatedAt: Date;
    firstDueAt?: Date;
  }>,
): ScheduledInstallment[] {
  assertPositiveAmount(input.totalRepaymentMinorUnits);
  assertSupportedTerm(input.termMonths);

  const firstDueAt = input.firstDueAt
    ? new Date(input.firstDueAt)
    : addUtcCalendarMonths(input.originatedAt, 1);
  if (firstDueAt.getTime() <= input.originatedAt.getTime()) {
    throw new Error("First installment must be due after origination.");
  }

  const count = BigInt(input.termMonths);
  const regularAmount = input.totalRepaymentMinorUnits / count;
  const finalAmount =
    input.totalRepaymentMinorUnits -
    regularAmount * BigInt(input.termMonths - 1);

  return Array.from({ length: input.termMonths }, (_, index) => ({
    sequence: index + 1,
    amountMinorUnits:
      index === input.termMonths - 1 ? finalAmount : regularAmount,
    dueAt: addUtcCalendarMonths(firstDueAt, index),
  }));
}

export function allocateRepaymentOldestFirst(
  input: Readonly<{
    repaymentAmountMinorUnits: bigint;
    installments: ReadonlyArray<
      Readonly<{
        id: string;
        sequence: number;
        amountMinorUnits: bigint;
        paidMinorUnits: bigint;
      }>
    >;
  }>,
): Array<Readonly<{ installmentId: string; amountMinorUnits: bigint }>> {
  assertPositiveAmount(input.repaymentAmountMinorUnits);

  const ordered = [...input.installments].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const outstanding = ordered.reduce((total, installment) => {
    if (
      installment.amountMinorUnits <= 0n ||
      installment.paidMinorUnits < 0n ||
      installment.paidMinorUnits > installment.amountMinorUnits
    ) {
      throw new Error("Installment balance is invalid.");
    }
    return total + installment.amountMinorUnits - installment.paidMinorUnits;
  }, 0n);

  if (input.repaymentAmountMinorUnits > outstanding) {
    throw new Error("Repayment exceeds the scheduled outstanding amount.");
  }

  let remaining = input.repaymentAmountMinorUnits;
  const allocations: Array<{
    installmentId: string;
    amountMinorUnits: bigint;
  }> = [];
  for (const installment of ordered) {
    if (remaining === 0n) break;
    const installmentOutstanding =
      installment.amountMinorUnits - installment.paidMinorUnits;
    if (installmentOutstanding === 0n) continue;
    const amount =
      remaining < installmentOutstanding ? remaining : installmentOutstanding;
    allocations.push({
      installmentId: installment.id,
      amountMinorUnits: amount,
    });
    remaining -= amount;
  }
  return allocations;
}

export function deriveInstallmentState(
  input: Readonly<{
    amountMinorUnits: bigint;
    paidMinorUnits: bigint;
    pendingMinorUnits?: bigint;
    dueAt: Date;
    now: Date;
    gracePeriodMs?: number;
  }>,
): Readonly<{
  state: InstallmentState;
  outstandingMinorUnits: bigint;
  daysOverdue: number;
}> {
  const pendingMinorUnits = input.pendingMinorUnits ?? 0n;
  const gracePeriodMs = input.gracePeriodMs ?? 0;
  if (
    input.amountMinorUnits <= 0n ||
    input.paidMinorUnits < 0n ||
    input.paidMinorUnits > input.amountMinorUnits ||
    pendingMinorUnits < 0n ||
    !Number.isSafeInteger(gracePeriodMs) ||
    gracePeriodMs < 0
  ) {
    throw new Error("Installment state input is invalid.");
  }

  const outstandingMinorUnits = input.amountMinorUnits - input.paidMinorUnits;
  const overdueFrom = input.dueAt.getTime() + gracePeriodMs;
  const overdueMs = Math.max(0, input.now.getTime() - overdueFrom);
  const daysOverdue = Math.floor(overdueMs / 86_400_000);

  if (outstandingMinorUnits === 0n) {
    return { state: "RESOLVED", outstandingMinorUnits, daysOverdue: 0 };
  }
  if (input.now.getTime() > overdueFrom && pendingMinorUnits > 0n) {
    return { state: "PAYMENT_PENDING", outstandingMinorUnits, daysOverdue };
  }
  if (input.paidMinorUnits > 0n) {
    return { state: "PARTIALLY_PAID", outstandingMinorUnits, daysOverdue };
  }
  if (input.now.getTime() < input.dueAt.getTime()) {
    return { state: "UPCOMING", outstandingMinorUnits, daysOverdue: 0 };
  }
  if (input.now.getTime() <= overdueFrom) {
    return { state: "DUE", outstandingMinorUnits, daysOverdue: 0 };
  }
  return { state: "OVERDUE", outstandingMinorUnits, daysOverdue };
}
