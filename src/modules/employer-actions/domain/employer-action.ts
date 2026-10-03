export const employerActionTypes = [
  "mark_reviewed",
  "request_employee_contact",
  "request_hr_follow_up",
] as const;

export type EmployerActionType = (typeof employerActionTypes)[number];
export type EmployerActionStatus =
  "completed" | "pending" | "rejected" | "failed";
export type EmployerActionProvider = "mock";

export type EmployerActionInput = Readonly<{
  loanId: string;
  organizationId: string;
  requestedBy: string;
  action: EmployerActionType;
  idempotencyKey: string;
}>;

export type EmployerActionResult = Readonly<{
  status: EmployerActionStatus;
  actionId: string;
  messageCode: string;
}>;

export interface EmployerActionAdapter {
  execute(input: EmployerActionInput): Promise<EmployerActionResult>;
}

export type EmployerActionAttempt = Readonly<{
  id: string;
  loanId: string;
  action: EmployerActionType;
  status: EmployerActionStatus;
  provider: EmployerActionProvider;
  idempotencyKey: string;
  adapterActionId: string | null;
  messageCode: string;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: Date;
  completedAt: Date | null;
}>;

export const employerActionLabels: Record<EmployerActionType, string> = {
  mark_reviewed: "Mark reviewed",
  request_employee_contact: "Request employee contact",
  request_hr_follow_up: "Request HR follow-up",
};

export const employerActionMessageLabels: Record<string, string> = {
  ACTION_PENDING: "The simulated action is pending.",
  SIMULATED_REVIEW_RECORDED: "Review recorded in this application.",
  SIMULATED_EMPLOYEE_CONTACT_REQUESTED:
    "Employee contact request simulated. No message was sent.",
  SIMULATED_HR_FOLLOW_UP_REQUESTED:
    "HR follow-up simulated. No HR system was contacted.",
  SIMULATED_ACTION_FAILED:
    "The simulated action failed without contacting an external system.",
  SIMULATED_ACTION_REJECTED:
    "The simulated action was rejected without contacting an external system.",
  UNSUPPORTED_ACTION: "The requested employer action is not supported.",
  ADAPTER_EXECUTION_FAILED:
    "The action adapter failed safely. No external action was confirmed.",
};

export function isEmployerActionType(
  value: string,
): value is EmployerActionType {
  return (employerActionTypes as readonly string[]).includes(value);
}
