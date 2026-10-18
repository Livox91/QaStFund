export type PayrollCredential =
  | { method: "token"; apiKey: string; apiSecret: string }
  | { method: "oauth_bearer"; accessToken: string };

export type SalarySlipSummary = Readonly<{
  externalId: string;
  externalEmployeeId: string;
  periodStart: string;
  periodEnd: string;
  grossPayMinorUnits: bigint;
  netPayMinorUnits: bigint;
  currency: string;
  documentStatus: 0 | 1 | 2;
  modifiedAt: string;
}>;

export type PayrollErrorCode =
  | "PAYROLL_NOT_CONFIGURED"
  | "PAYROLL_AUTHENTICATION_FAILED"
  | "PAYROLL_PERMISSION_DENIED"
  | "PAYROLL_EMPLOYEE_NOT_FOUND"
  | "PAYROLL_EMPLOYEE_INACTIVE"
  | "PAYROLL_PERIOD_OUTSIDE_EMPLOYMENT"
  | "SALARY_STRUCTURE_ASSIGNMENT_REQUIRED"
  | "SALARY_SLIP_ALREADY_EXISTS"
  | "PAYROLL_VALIDATION_FAILED"
  | "PAYROLL_RATE_LIMITED"
  | "PAYROLL_REQUEST_TIMEOUT"
  | "PAYROLL_REMOTE_UNAVAILABLE"
  | "PAYROLL_RESPONSE_INVALID";

export class PayrollIntegrationError extends ApplicationError {
  constructor(
    readonly code: PayrollErrorCode,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(code, payrollMessage(code), status);
    this.name = "PayrollIntegrationError";
  }
}

function payrollMessage(code: PayrollErrorCode): string {
  const messages: Record<PayrollErrorCode, string> = {
    PAYROLL_NOT_CONFIGURED: "ERPNext payroll access is not configured.",
    PAYROLL_AUTHENTICATION_FAILED: "ERPNext rejected the payroll credential.",
    PAYROLL_PERMISSION_DENIED:
      "The ERPNext payroll identity lacks a required permission.",
    PAYROLL_EMPLOYEE_NOT_FOUND: "The mapped ERPNext employee was not found.",
    PAYROLL_EMPLOYEE_INACTIVE: "The ERPNext employee is not active.",
    PAYROLL_PERIOD_OUTSIDE_EMPLOYMENT:
      "The payroll period is outside the employee's employment dates.",
    SALARY_STRUCTURE_ASSIGNMENT_REQUIRED:
      "A submitted salary structure assignment covering this period is required.",
    SALARY_SLIP_ALREADY_EXISTS:
      "A draft or submitted salary slip already exists for this employee and period.",
    PAYROLL_VALIDATION_FAILED:
      "Frappe HR rejected the salary slip. Review its payroll configuration and Error Log.",
    PAYROLL_RATE_LIMITED:
      "ERPNext payroll requests are temporarily rate limited.",
    PAYROLL_REQUEST_TIMEOUT:
      "ERPNext did not respond before the payroll request timed out.",
    PAYROLL_REMOTE_UNAVAILABLE: "ERPNext payroll is temporarily unavailable.",
    PAYROLL_RESPONSE_INVALID: "ERPNext returned an invalid payroll response.",
  };
  return messages[code];
}
import { ApplicationError } from "@/shared/errors/application-error";
