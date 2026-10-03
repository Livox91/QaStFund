import {
  EmployeeDirectoryError,
  type EmployeeDirectoryAdapter,
  type EmployeeDirectoryConfig,
  type EmployeeDirectorySecretProvider,
  type EmployeePage,
  type ExternalEmployee,
} from "@/modules/employee-directory/domain/employee-directory";
import {
  resolveHost,
  type HostResolver,
  validateErpNextBaseUrl,
} from "@/modules/employee-directory/infrastructure/erpnext-url-security";

const EMPLOYEE_FIELDS = [
  "name",
  "employee",
  "employee_name",
  "company_email",
  "personal_email",
  "status",
  "modified",
] as const;

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

type ErpEmployee = Record<string, unknown>;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeErpNextEmployee(
  record: ErpEmployee,
): ExternalEmployee | null {
  const externalId = nonEmpty(record.name);
  if (!externalId) return null;
  const employeeCode = nonEmpty(record.employee);
  const fullName = nonEmpty(record.employee_name) ?? employeeCode ?? externalId;
  const email =
    nonEmpty(record.company_email) ?? nonEmpty(record.personal_email);
  const employmentStatus = nonEmpty(record.status) ?? "Unknown";
  const modifiedAt = nonEmpty(record.modified);
  return {
    externalId,
    ...(employeeCode ? { employeeCode } : {}),
    fullName,
    ...(email ? { email: email.toLowerCase() } : {}),
    employmentStatus,
    ...(modifiedAt ? { modifiedAt } : {}),
  };
}

export class ErpNextEmployeeDirectoryAdapter implements EmployeeDirectoryAdapter {
  constructor(
    private readonly config: EmployeeDirectoryConfig,
    private readonly secretProvider: EmployeeDirectorySecretProvider,
    private readonly options: {
      fetch?: FetchLike;
      resolveHost?: HostResolver;
      sleep?: Sleep;
      pageSize?: number;
      maxRetries?: number;
      allowLocalDevelopment?: boolean;
    } = {},
  ) {}

  async testConnection() {
    try {
      await this.request("Employee", {
        fields: JSON.stringify(["name"]),
        limit_page_length: "1",
      });
      return { ok: true, messageCode: "CONNECTION_OK" } as const;
    } catch (error) {
      return {
        ok: false,
        messageCode:
          error instanceof EmployeeDirectoryError
            ? error.code
            : "UNEXPECTED_ERROR",
      } as const;
    }
  }

  async listEmployees(cursor?: string): Promise<EmployeePage> {
    const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new EmployeeDirectoryError("INVALID_CONFIGURATION");
    }
    const pageSize = this.options.pageSize ?? 100;
    const response = await this.request("Employee", {
      fields: JSON.stringify(EMPLOYEE_FIELDS),
      limit_start: String(offset),
      limit_page_length: String(pageSize),
      order_by: "name asc",
    });
    const employees = response.data
      .map(normalizeErpNextEmployee)
      .filter((employee): employee is ExternalEmployee => employee !== null);
    return {
      employees,
      ...(response.data.length === pageSize
        ? { nextCursor: String(offset + pageSize) }
        : {}),
    };
  }

  async getEmployee(externalEmployeeId: string) {
    if (!externalEmployeeId.trim()) {
      throw new EmployeeDirectoryError("INVALID_CONFIGURATION");
    }
    try {
      const response = await this.request(
        `Employee/${encodeURIComponent(externalEmployeeId)}`,
        { fields: JSON.stringify(EMPLOYEE_FIELDS) },
      );
      return normalizeErpNextEmployee(response.data[0] ?? {});
    } catch (error) {
      if (
        error instanceof EmployeeDirectoryError &&
        error.code === "REMOTE_NOT_FOUND"
      ) {
        return null;
      }
      throw error;
    }
  }

  private async request(
    resource: string,
    query: Record<string, string>,
  ): Promise<{ data: ErpEmployee[] }> {
    const baseUrl = await validateErpNextBaseUrl(
      this.config.baseUrl,
      this.options.resolveHost ?? resolveHost,
      this.options.allowLocalDevelopment ?? false,
    );
    const configuredPath = this.config.apiPath.replaceAll(
      "{version}",
      this.config.apiVersion,
    );
    const apiPath = `/${configuredPath.replace(/^\/+|\/+$/g, "")}`;
    const url = new URL(
      `${baseUrl.pathname}${apiPath}/${resource}`.replace(/\/{2,}/g, "/"),
      baseUrl.origin,
    );
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const secret = this.secretProvider.getSecret({
      organizationId: this.config.organizationId,
      reference: this.config.credentialReference,
      authMethod: this.config.authMethod,
    });
    const authorization =
      secret.method === "token"
        ? `token ${secret.apiKey}:${secret.apiSecret}`
        : `Bearer ${secret.accessToken}`;
    const maxRetries = this.options.maxRetries ?? 2;
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs,
      );
      try {
        const response = await (this.options.fetch ?? fetch)(url, {
          method: "GET",
          headers: { Accept: "application/json", Authorization: authorization },
          redirect: "manual",
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          throw new EmployeeDirectoryError("UNSAFE_URL");
        }
        if (response.status === 401) {
          throw new EmployeeDirectoryError("AUTHENTICATION_FAILED");
        }
        if (response.status === 403) {
          throw new EmployeeDirectoryError("PERMISSION_DENIED");
        }
        if (response.status === 404) {
          throw new EmployeeDirectoryError("REMOTE_NOT_FOUND");
        }
        if (response.status === 429) {
          throw new EmployeeDirectoryError("RATE_LIMITED", true);
        }
        if (response.status >= 500) {
          throw new EmployeeDirectoryError("REMOTE_SERVER_ERROR", true);
        }
        if (!response.ok) {
          throw new EmployeeDirectoryError("REMOTE_RESPONSE_INVALID");
        }
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("data" in body)) {
          throw new EmployeeDirectoryError("REMOTE_RESPONSE_INVALID");
        }
        const data = (body as { data: unknown }).data;
        const records = Array.isArray(data) ? data : [data];
        if (
          records.some(
            (record) =>
              record === null ||
              typeof record !== "object" ||
              Array.isArray(record),
          )
        ) {
          throw new EmployeeDirectoryError("REMOTE_RESPONSE_INVALID");
        }
        return { data: records as ErpEmployee[] };
      } catch (error) {
        const directoryError =
          error instanceof EmployeeDirectoryError
            ? error
            : error instanceof Error && error.name === "AbortError"
              ? new EmployeeDirectoryError("REQUEST_TIMEOUT", true)
              : new EmployeeDirectoryError("REMOTE_SERVER_ERROR", true);
        if (!directoryError.retryable || attempt >= maxRetries) {
          throw directoryError;
        }
        await (
          this.options.sleep ??
          ((milliseconds) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)))
        )(100 * 2 ** attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}
