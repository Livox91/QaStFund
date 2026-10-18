import type { EmployeeDirectoryConfig } from "@/modules/employee-directory/domain/employee-directory";
import {
  resolveHost,
  type HostResolver,
  validateErpNextBaseUrl,
} from "@/modules/employee-directory/infrastructure/erpnext-url-security";
import {
  PayrollIntegrationError,
  type PayrollCredential,
  type SalarySlipSummary,
} from "@/modules/payroll-integration/domain/payroll";

type RecordValue = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function moneyToMinorUnits(value: unknown): bigint {
  if (typeof value !== "number" && typeof value !== "string")
    throw new PayrollIntegrationError("PAYROLL_RESPONSE_INVALID", 502);
  const normalized = String(value);
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(normalized))
    throw new PayrollIntegrationError("PAYROLL_RESPONSE_INVALID", 502);
  const [whole, fraction = ""] = normalized.split(".");
  const negative = whole.startsWith("-");
  const absoluteWhole = negative ? whole.slice(1) : whole;
  const rounded = BigInt((fraction + "00").slice(0, 2));
  const result = BigInt(absoluteWhole) * 100n + rounded;
  return negative ? -result : result;
}

function normalizeSlip(record: RecordValue): SalarySlipSummary {
  const externalId = text(record.name);
  const employee = text(record.employee);
  const start = text(record.start_date);
  const end = text(record.end_date);
  const currency = text(record.currency);
  const modified = text(record.modified);
  const docstatus = Number(record.docstatus);
  if (
    !externalId ||
    !employee ||
    !start ||
    !end ||
    !currency ||
    !modified ||
    ![0, 1, 2].includes(docstatus)
  ) {
    throw new PayrollIntegrationError("PAYROLL_RESPONSE_INVALID", 502);
  }
  return {
    externalId,
    externalEmployeeId: employee,
    periodStart: start,
    periodEnd: end,
    grossPayMinorUnits: moneyToMinorUnits(record.gross_pay),
    netPayMinorUnits: moneyToMinorUnits(record.net_pay),
    currency,
    documentStatus: docstatus as 0 | 1 | 2,
    modifiedAt: modified,
  };
}

export class ErpNextPayrollAdapter {
  constructor(
    private readonly config: EmployeeDirectoryConfig,
    private readonly credential: PayrollCredential,
    private readonly options: {
      fetch?: typeof fetch;
      resolveHost?: HostResolver;
      allowLocalDevelopment?: boolean;
    } = {},
  ) {}

  async inspect(employeeId: string, periodStart: string, periodEnd: string) {
    const employee = await this.getOne("Employee", employeeId, [
      "name",
      "status",
      "company",
      "date_of_joining",
      "relieving_date",
    ]);
    if (!employee)
      throw new PayrollIntegrationError("PAYROLL_EMPLOYEE_NOT_FOUND", 404);
    if (text(employee.status)?.toLowerCase() !== "active")
      throw new PayrollIntegrationError("PAYROLL_EMPLOYEE_INACTIVE", 409);
    const joined = text(employee.date_of_joining);
    const relieved = text(employee.relieving_date);
    if ((joined && joined > periodEnd) || (relieved && relieved < periodStart))
      throw new PayrollIntegrationError(
        "PAYROLL_PERIOD_OUTSIDE_EMPLOYMENT",
        409,
      );
    const assignments = await this.list("Salary Structure Assignment", {
      fields: JSON.stringify(["name", "salary_structure", "from_date"]),
      filters: JSON.stringify([
        ["employee", "=", employeeId],
        ["docstatus", "=", 1],
        ["from_date", "<=", periodEnd],
      ]),
      order_by: "from_date desc",
      limit_page_length: "1",
    });
    if (assignments.length === 0)
      throw new PayrollIntegrationError(
        "SALARY_STRUCTURE_ASSIGNMENT_REQUIRED",
        409,
      );
    return {
      employeeId,
      company: text(employee.company),
      salaryStructure: text(assignments[0].salary_structure),
    };
  }

  async listSalarySlips(employeeId: string, start: string, end: string) {
    const records = await this.list("Salary Slip", {
      fields: JSON.stringify([
        "name",
        "employee",
        "start_date",
        "end_date",
        "gross_pay",
        "net_pay",
        "currency",
        "docstatus",
        "modified",
      ]),
      filters: JSON.stringify([
        ["employee", "=", employeeId],
        ["start_date", "=", start],
        ["end_date", "=", end],
        ["docstatus", "<", 2],
      ]),
      limit_page_length: "20",
    });
    return records.map(normalizeSlip);
  }

  async createDraftSalarySlip(employeeId: string, start: string, end: string) {
    const existing = await this.listSalarySlips(employeeId, start, end);
    if (existing.length > 0)
      throw new PayrollIntegrationError("SALARY_SLIP_ALREADY_EXISTS", 409);
    const prerequisite = await this.inspect(employeeId, start, end);
    const record = await this.request("POST", "Salary Slip", undefined, {
      employee: employeeId,
      start_date: start,
      end_date: end,
      posting_date: end,
      ...(prerequisite.company ? { company: prerequisite.company } : {}),
    });
    if (Array.isArray(record))
      throw new PayrollIntegrationError("PAYROLL_RESPONSE_INVALID", 502);
    return normalizeSlip(record);
  }

  private async getOne(doctype: string, name: string, fields: string[]) {
    try {
      const result = await this.request(
        "GET",
        `${doctype}/${encodeURIComponent(name)}`,
        { fields: JSON.stringify(fields) },
      );
      if (Array.isArray(result))
        throw new PayrollIntegrationError("PAYROLL_RESPONSE_INVALID", 502);
      return result;
    } catch (error) {
      if (
        error instanceof PayrollIntegrationError &&
        error.code === "PAYROLL_EMPLOYEE_NOT_FOUND"
      )
        return null;
      throw error;
    }
  }

  private async list(doctype: string, query: Record<string, string>) {
    const value = await this.request("GET", doctype, query);
    return Array.isArray(value) ? (value as RecordValue[]) : [];
  }

  private async request(
    method: "GET" | "POST",
    resource: string,
    query?: Record<string, string>,
    body?: RecordValue,
  ): Promise<RecordValue | RecordValue[]> {
    const base = await validateErpNextBaseUrl(
      this.config.baseUrl,
      this.options.resolveHost ?? resolveHost,
      this.options.allowLocalDevelopment ?? false,
    );
    const path = `/${this.config.apiPath.replace(/^\/+|\/+$/g, "")}`;
    const url = new URL(
      `${base.pathname}${path}/${resource}`.replace(/\/{2,}/g, "/"),
      base.origin,
    );
    for (const [key, value] of Object.entries(query ?? {}))
      url.searchParams.set(key, value);
    const authorization =
      this.credential.method === "token"
        ? `token ${this.credential.apiKey}:${this.credential.apiSecret}`
        : `Bearer ${this.credential.accessToken}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status === 401)
        throw new PayrollIntegrationError("PAYROLL_AUTHENTICATION_FAILED", 502);
      if (response.status === 403)
        throw new PayrollIntegrationError("PAYROLL_PERMISSION_DENIED", 502);
      if (response.status === 404)
        throw new PayrollIntegrationError("PAYROLL_EMPLOYEE_NOT_FOUND", 404);
      if (response.status === 429)
        throw new PayrollIntegrationError("PAYROLL_RATE_LIMITED", 503, true);
      if (response.status >= 500)
        throw new PayrollIntegrationError(
          "PAYROLL_REMOTE_UNAVAILABLE",
          503,
          true,
        );
      if (!response.ok) {
        throw new PayrollIntegrationError("PAYROLL_VALIDATION_FAILED", 409);
      }
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || !("data" in payload))
        throw new PayrollIntegrationError("PAYROLL_RESPONSE_INVALID", 502);
      const data = (payload as { data: unknown }).data;
      if (
        (!Array.isArray(data) && (!data || typeof data !== "object")) ||
        (Array.isArray(data) &&
          data.some((item) => !item || typeof item !== "object"))
      )
        throw new PayrollIntegrationError("PAYROLL_RESPONSE_INVALID", 502);
      return data as RecordValue | RecordValue[];
    } catch (error) {
      if (error instanceof PayrollIntegrationError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new PayrollIntegrationError("PAYROLL_REQUEST_TIMEOUT", 503, true);
      throw new PayrollIntegrationError(
        "PAYROLL_REMOTE_UNAVAILABLE",
        503,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
