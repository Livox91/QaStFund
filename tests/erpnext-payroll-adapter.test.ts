import { describe, expect, it, vi } from "vitest";

import { ErpNextPayrollAdapter } from "@/modules/payroll-integration/infrastructure/erpnext-payroll-adapter";

const config = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  baseUrl: "http://localhost:8000",
  apiPath: "/api/resource",
  apiVersion: "v1",
  authMethod: "token" as const,
  credentialReference: "payroll",
  timeoutMs: 1_000,
};

const slip = {
  name: "SAL-0001",
  employee: "HR-EMP-0001",
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  gross_pay: 5000,
  net_pay: 4200.5,
  currency: "USD",
  docstatus: 0,
  modified: "2026-10-01T12:00:00.000Z",
};

function adapter(fetchMock: typeof fetch) {
  return new ErpNextPayrollAdapter(
    config,
    { method: "token", apiKey: "key", apiSecret: "secret" },
    {
      fetch: fetchMock,
      allowLocalDevelopment: true,
      resolveHost: async () => ["127.0.0.1"],
    },
  );
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ERPNext payroll adapter", () => {
  it("retrieves only normalized salary summary fields", async () => {
    const request = vi.fn(async () => response([slip]));
    const result = await adapter(request as typeof fetch).listSalarySlips(
      "HR-EMP-0001",
      "2026-09-01",
      "2026-09-30",
    );
    expect(result).toEqual([
      expect.objectContaining({
        externalId: "SAL-0001",
        netPayMinorUnits: 420050n,
        grossPayMinorUnits: 500000n,
        documentStatus: 0,
      }),
    ]);
    const calls = request.mock.calls as unknown as Array<[URL, RequestInit?]>;
    expect(calls[0]?.[0].toString()).not.toContain("employee_name");
  });

  it("prevents a duplicate draft or submitted slip before writing", async () => {
    const request = vi.fn(async () => response([slip]));
    await expect(
      adapter(request as typeof fetch).createDraftSalarySlip(
        "HR-EMP-0001",
        "2026-09-01",
        "2026-09-30",
      ),
    ).rejects.toMatchObject({ code: "SALARY_SLIP_ALREADY_EXISTS" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("uses the supported draft lifecycle after validating employment and assignment", async () => {
    const request = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        const url = _url.toString();
        if (url.includes("Salary%20Slip?") || url.includes("Salary Slip?"))
          return response([]);
        if (url.includes("Employee/HR-EMP-0001"))
          return response({
            name: "HR-EMP-0001",
            status: "Active",
            company: "QastFund Test",
            date_of_joining: "2025-01-01",
            relieving_date: null,
          });
        if (
          url.includes("Salary%20Structure%20Assignment") ||
          url.includes("Salary Structure Assignment")
        )
          return response([
            {
              name: "SSA-1",
              salary_structure: "Monthly",
              from_date: "2025-01-01",
            },
          ]);
        expect(init?.method).toBe("POST");
        return response(slip);
      },
    );
    const result = await adapter(request as typeof fetch).createDraftSalarySlip(
      "HR-EMP-0001",
      "2026-09-01",
      "2026-09-30",
    );
    expect(result.externalId).toBe("SAL-0001");
    const post = request.mock.calls.find((call) => call[1]?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      employee: "HR-EMP-0001",
      company: "QastFund Test",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
    });
    expect(JSON.parse(String(post?.[1]?.body))).not.toHaveProperty("docstatus");
  });

  it("reports missing submitted salary assignment without attempting creation", async () => {
    const request = vi.fn(async (_url: URL | RequestInfo) => {
      const url = _url.toString();
      if (url.includes("Salary%20Slip?") || url.includes("Salary Slip?"))
        return response([]);
      if (url.includes("Employee/"))
        return response({
          name: "HR-EMP-0001",
          status: "Active",
          company: "QastFund Test",
          date_of_joining: "2025-01-01",
        });
      return response([]);
    });
    await expect(
      adapter(request as typeof fetch).createDraftSalarySlip(
        "HR-EMP-0001",
        "2026-09-01",
        "2026-09-30",
      ),
    ).rejects.toMatchObject({ code: "SALARY_STRUCTURE_ASSIGNMENT_REQUIRED" });
  });

  it.each([
    [401, "PAYROLL_AUTHENTICATION_FAILED"],
    [403, "PAYROLL_PERMISSION_DENIED"],
    [429, "PAYROLL_RATE_LIMITED"],
  ])("maps remote status %s to a safe code", async (status, code) => {
    const request = vi.fn(async () => response({}, status));
    await expect(
      adapter(request as typeof fetch).listSalarySlips(
        "HR-EMP-0001",
        "2026-09-01",
        "2026-09-30",
      ),
    ).rejects.toEqual(expect.objectContaining({ code }));
  });
});
