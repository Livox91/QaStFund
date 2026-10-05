import type { ArcWallet } from "@/modules/arc-wallet/domain/arc-wallet";
import type { Employee } from "@/modules/employees/domain/employee";
import type { BorrowingCapacity } from "@/modules/policies/domain/lending-policy";

export type EmployeeOnboardingState = Readonly<{
  account: "verified";
  membership: "verified";
  profile: "eligible" | "ineligible";
  wallet:
    | "setup_required"
    | "pending"
    | "ready"
    | "recovery_required"
    | "temporarily_unavailable";
  eligibility: "eligible" | "ineligible" | "temporarily_unavailable";
  readyToUse: boolean;
  nextAction:
    | "setup_wallet"
    | "recover_wallet"
    | "browse_offers"
    | "contact_employer"
    | "try_later";
}>;

export function getEmployeeOnboardingState(input: {
  employee: Employee;
  wallet: ArcWallet | null;
  capacity: BorrowingCapacity;
}): EmployeeOnboardingState {
  const profile =
    input.employee.employmentStatus === "active" ? "eligible" : "ineligible";
  const wallet =
    !input.wallet || input.wallet.enrollmentState === "NOT_STARTED"
      ? "setup_required"
      : input.wallet.enrollmentState === "FAILED_RECOVERABLE"
        ? "recovery_required"
        : input.wallet.status === "FAILED"
          ? "temporarily_unavailable"
          : input.wallet.status === "ACTIVE" &&
              input.wallet.enrollmentState === "ACTIVE"
            ? "ready"
            : "pending";
  const eligibility =
    profile === "ineligible" || !input.capacity.employeeCanBorrow
      ? "ineligible"
      : !input.capacity.lendingEnabled || !input.capacity.borrowingEnabled
        ? "temporarily_unavailable"
        : input.capacity.eligible
          ? "eligible"
          : "ineligible";
  const readyToUse = wallet === "ready" && eligibility === "eligible";
  return {
    account: "verified",
    membership: "verified",
    profile,
    wallet,
    eligibility,
    readyToUse,
    nextAction:
      wallet === "setup_required"
        ? "setup_wallet"
        : wallet === "recovery_required"
          ? "recover_wallet"
          : wallet === "pending" || wallet === "temporarily_unavailable"
            ? "try_later"
            : eligibility === "eligible"
              ? "browse_offers"
              : "contact_employer",
  };
}
