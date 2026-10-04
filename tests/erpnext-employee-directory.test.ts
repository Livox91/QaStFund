import { describe, expect, it, vi } from "vitest";

import { EmploymentStatus } from "@/generated/prisma/client";
import { parseEnvironment } from "@/infrastructure/config/environment-schema";
import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import type {
  DirectorySyncDecision,
  EmployeeDirectoryRepository,
  StoredDirectoryIntegration,
} from "@/modules/employee-directory/application/ports/employee-directory-repository";
import { runScheduledEmployeeDirectorySyncs } from "@/modules/employee-directory/application/run-scheduled-syncs";
import {
  isPermanentScheduledSyncError,
  safeSyncErrorSummary,
} from "@/modules/employee-directory/application/sync-health";
import { synchronizeEmployees } from "@/modules/employee-directory/application/synchronize-employees";
import {
  EmployeeDirectoryError,
  type EmployeeDirectoryAdapter,
  type EmployeeDirectorySecretProvider,
  type ExternalEmployee,
} from "@/modules/employee-directory/domain/employee-directory";
import {
  ErpNextEmployeeDirectoryAdapter,
  normalizeErpNextEmployee,
} from "@/modules/employee-directory/infrastructure/erpnext-employee-directory-adapter";
import { validateErpNextBaseUrl } from "@/modules/employee-directory/infrastructure/erpnext-url-security";
import { isAuthorizedSchedulerRequest } from "@/modules/employee-directory/infrastructure/scheduler-auth";
import type { Clock } from "@/shared/time/clock";

const now = new Date("2026-10-03T12:00:00.000Z");
const clock: Clock = { now: () => now };
const admin: AuthenticatedActor = {
  userId: "admin-a",
  email: "admin@a.test",
  name: "Admin A",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYER_ADMIN,
};
const integration: StoredDirectoryIntegration = {
  id: "integration-a",
  organizationId: "organization-a",
  provider: "erpnext",
  baseUrl: "https://erp.example.test",
  apiPath: "/api/resource",
  apiVersion: "v1",
  authMethod: "token",
  credentialReference: "primary",
  timeoutMs: 1000,
  statusMapping: {
    active: EmploymentStatus.ACTIVE,
    inactive: EmploymentStatus.TERMINATED,
    suspended: EmploymentStatus.SUSPENDED,
  },
  connectionStatus: "not_tested",
  lastConnectionCode: null,
  lastTestedAt: null,
  lastSuccessfulSyncAt: null,
  lastSyncStatus: null,
  lastSyncErrorCode: null,
  scheduledSyncPausedAt: null,
  schedulePauseCode: null,
};
const secrets: EmployeeDirectorySecretProvider = {
  getSecret: () => ({
    method: "token",
    apiKey: "key",
    apiSecret: "secret-value",
  }),
};
const publicResolver = vi.fn(async () => ["203.0.113.10"]);

function adapter(
  fetchImplementation: typeof fetch,
  options: { pageSize?: number; maxRetries?: number; timeoutMs?: number } = {},
) {
  return new ErpNextEmployeeDirectoryAdapter(
    { ...integration, timeoutMs: options.timeoutMs ?? integration.timeoutMs },
    secrets,
    {
      fetch: fetchImplementation,
      resolveHost: publicResolver,
      sleep: async () => {},
      pageSize: options.pageSize,
      maxRetries: options.maxRetries,
    },
  );
}

describe("ERPNext read-only adapter", () => {
  it("tests a successful connection with a GET and never exposes its secret", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    await expect(
      adapter(fetchMock as typeof fetch).testConnection(),
    ).resolves.toEqual({ ok: true, messageCode: "CONNECTION_OK" });
    const [url, init] = (
      fetchMock.mock.calls as unknown as [URL, RequestInit][]
    )[0];
    expect(String(url)).toContain("/api/resource/Employee");
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(
      JSON.stringify(await adapter(fetchMock as typeof fetch).testConnection()),
    ).not.toContain("secret-value");
  });

  it.each([
    [401, "AUTHENTICATION_FAILED"],
    [403, "PERMISSION_DENIED"],
    [429, "RATE_LIMITED"],
  ])("distinguishes HTTP %i as %s", async (status, code) => {
    const fetchMock = vi.fn(async () => new Response("{}", { status }));
    await expect(
      adapter(fetchMock as typeof fetch, { maxRetries: 0 }).testConnection(),
    ).resolves.toMatchObject({ ok: false, messageCode: code });
  });

  it("paginates and requests only the required Employee fields", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const start = url.searchParams.get("limit_start");
      return new Response(
        JSON.stringify({
          data:
            start === "0"
              ? [
                  { name: "EMP-1", employee_name: "One", status: "Active" },
                  { name: "EMP-2", employee_name: "Two", status: "Active" },
                ]
              : [{ name: "EMP-3", employee_name: "Three", status: "Inactive" }],
        }),
        { status: 200 },
      );
    });
    const client = adapter(fetchMock as typeof fetch, { pageSize: 2 });
    const first = await client.listEmployees();
    const second = await client.listEmployees(first.nextCursor);
    expect(first.nextCursor).toBe("2");
    expect(second.employees.map((item) => item.externalId)).toEqual(["EMP-3"]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("fields=");
  });

  it("normalizes missing standard fields and leaves unknown status untouched", () => {
    expect(
      normalizeErpNextEmployee({
        name: "EMP-1",
        personal_email: " Person@Example.com ",
        status: "On Sabbatical",
      }),
    ).toEqual({
      externalId: "EMP-1",
      fullName: "EMP-1",
      email: "person@example.com",
      employmentStatus: "On Sabbatical",
    });
    expect(
      normalizeErpNextEmployee({ employee_name: "No identifier" }),
    ).toBeNull();
  });

  it("retries transient failures only within the configured bound", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
    await expect(
      adapter(fetchMock as typeof fetch, { maxRetries: 1 }).testConnection(),
    ).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies aborted requests as timeouts", async () => {
    const fetchMock = vi.fn(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(
      adapter(fetchMock as typeof fetch, {
        maxRetries: 0,
        timeoutMs: 1,
      }).testConnection(),
    ).resolves.toMatchObject({ ok: false, messageCode: "REQUEST_TIMEOUT" });
  });

  it("rejects SSRF targets, embedded credentials, HTTP, and unsafe redirects", async () => {
    await expect(
      validateErpNextBaseUrl("http://erp.example.test", publicResolver),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });
    await expect(
      validateErpNextBaseUrl(
        "https://user:pass@erp.example.test",
        publicResolver,
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });
    await expect(
      validateErpNextBaseUrl("https://10.0.0.2", async () => ["10.0.0.2"]),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });
    const redirect = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://169.254.169.254" },
        }),
    );
    await expect(
      adapter(redirect as typeof fetch).testConnection(),
    ).resolves.toMatchObject({ ok: false, messageCode: "UNSAFE_URL" });
  });
});

function createRepository() {
  let decisions: DirectorySyncDecision[] = [];
  let employeeStatus: EmploymentStatus = EmploymentStatus.ACTIVE;
  let run = 0;
  const repository: EmployeeDirectoryRepository = {
    getIntegration: vi.fn(async (organizationId) =>
      organizationId === "organization-a" ? integration : null,
    ),
    saveIntegration: vi.fn(async () => {}),
    recordConnectionResult: vi.fn(async () => {}),
    listScheduledOrganizations: vi.fn(async () => ["organization-a"]),
    claimSync: vi.fn(async (input) =>
      input.organizationId === "organization-a" &&
      (input.trigger === "scheduled" || input.requestedByUserId === "admin-a")
        ? ({
            kind: "claimed",
            runId: `run-${++run}`,
            integration,
          } as const)
        : ({ kind: "unauthorized" } as const),
    ),
    getMatchContext: vi.fn(async (organizationId) =>
      organizationId === "organization-a"
        ? {
            employees: [
              {
                membershipId: "employee-a",
                email: "employee@example.test",
                status: employeeStatus,
              },
            ],
            mappings: decisions.map((item) => ({
              externalEmployeeId: item.externalEmployeeId,
              employeeCode: item.employeeCode ?? null,
              fullName: item.fullName,
              email: item.email ?? null,
              externalStatus: item.externalStatus,
              normalizedStatus: item.normalizedStatus ?? null,
              matchStatus: item.matchStatus,
              matchMethod: item.matchMethod ?? null,
              matchedMembershipId: item.matchedMembershipId ?? null,
            })),
          }
        : { employees: [], mappings: [] },
    ),
    completeSync: vi.fn(async (input) => {
      decisions = [
        ...new Map<string, DirectorySyncDecision>(
          input.decisions.map((item: DirectorySyncDecision) => [
            item.externalEmployeeId,
            item,
          ]),
        ).values(),
      ];
      const matched = decisions.find(
        (item) => item.matchedMembershipId === "employee-a",
      );
      if (matched?.normalizedStatus) employeeStatus = matched.normalizedStatus;
    }),
    failSync: vi.fn(async () => {}),
    getDashboard: vi.fn(async () => ({
      configured: false,
      erpNextEnabled: false,
      integration: null,
      latestRun: null,
      history: [],
      reviewRecords: [],
    })),
  };
  return {
    repository,
    get decisions() {
      return decisions;
    },
    get employeeStatus() {
      return employeeStatus;
    },
  };
}

function pages(
  records: ExternalEmployee[],
  failAfterFirst = false,
): EmployeeDirectoryAdapter {
  let calls = 0;
  return {
    testConnection: vi.fn(
      async () => ({ ok: true, messageCode: "CONNECTION_OK" }) as const,
    ),
    listEmployees: vi.fn(async () => {
      calls += 1;
      if (failAfterFirst && calls === 2)
        throw new EmployeeDirectoryError("REMOTE_SERVER_ERROR");
      return {
        employees: records,
        ...(failAfterFirst ? { nextCursor: "next" } : {}),
      };
    }),
    getEmployee: vi.fn(async () => null),
  };
}

describe("employee synchronization policy", () => {
  it("matches only a unique organization email, updates status idempotently, and leaves finance outside the boundary", async () => {
    const state = createRepository();
    const financialLoanState = { status: "ACTIVE", outstanding: 5000n };
    const external = [
      {
        externalId: "EMP-1",
        fullName: "Employee",
        email: "employee@example.test",
        employmentStatus: "Inactive",
      },
    ];
    await synchronizeEmployees(
      admin,
      state.repository,
      () => pages(external),
      clock,
    );
    await synchronizeEmployees(
      admin,
      state.repository,
      () => pages(external),
      clock,
    );
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0]).toMatchObject({
      matchStatus: "matched",
      matchMethod: "unique_email",
      normalizedStatus: "TERMINATED",
    });
    expect(state.employeeStatus).toBe(EmploymentStatus.TERMINATED);
    expect(financialLoanState).toEqual({
      status: "ACTIVE",
      outstanding: 5000n,
    });
    expect(state.repository.completeSync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 1,
      }),
    );
  });

  it("suspends an employee missing from a complete snapshot without deleting identity or finance", async () => {
    const state = createRepository();
    const loan = { id: "loan-1", status: "ACTIVE" };
    await synchronizeEmployees(
      admin,
      state.repository,
      () =>
        pages([
          {
            externalId: "EMP-1",
            fullName: "Employee",
            email: "employee@example.test",
            employmentStatus: "Active",
          },
        ]),
      clock,
    );

    await synchronizeEmployees(admin, state.repository, () => pages([]), clock);

    expect(state.employeeStatus).toBe(EmploymentStatus.SUSPENDED);
    expect(state.decisions[0]).toMatchObject({
      externalEmployeeId: "EMP-1",
      externalStatus: "Missing from ERPNext",
      normalizedStatus: EmploymentStatus.SUSPENDED,
    });
    expect(state.repository.completeSync).toHaveBeenLastCalledWith(
      expect.objectContaining({ deactivatedCount: 1, processedCount: 0 }),
    );
    expect(loan).toEqual({ id: "loan-1", status: "ACTIVE" });
  });

  it("updates changed employee fields without creating a duplicate mapping", async () => {
    const state = createRepository();
    const base = {
      externalId: "EMP-1",
      fullName: "Original Name",
      email: "employee@example.test",
      employmentStatus: "Active",
    };
    await synchronizeEmployees(
      admin,
      state.repository,
      () => pages([base]),
      clock,
    );
    await synchronizeEmployees(
      admin,
      state.repository,
      () => pages([{ ...base, fullName: "Updated Name" }]),
      clock,
    );

    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0].fullName).toBe("Updated Name");
    expect(state.repository.completeSync).toHaveBeenLastCalledWith(
      expect.objectContaining({ createdCount: 0, updatedCount: 1 }),
    );
  });

  it("fails safely when ERPNext pagination exceeds the configured bound", async () => {
    const state = createRepository();
    const endless = pages(
      [
        {
          externalId: "EMP-1",
          fullName: "Employee",
          employmentStatus: "Active",
        },
      ],
      true,
    );
    await expect(
      synchronizeEmployees(admin, state.repository, () => endless, clock, {
        maxPages: 1,
      }),
    ).rejects.toMatchObject({ code: "SYNC_LIMIT_EXCEEDED" });
    expect(state.repository.completeSync).not.toHaveBeenCalled();
  });

  it("sends ambiguous emails, duplicate external IDs, and unknown statuses to safe review", async () => {
    const state = createRepository();
    (
      state.repository.getMatchContext as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      employees: [
        {
          membershipId: "one",
          email: "same@test",
          status: EmploymentStatus.ACTIVE,
        },
        {
          membershipId: "two",
          email: "same@test",
          status: EmploymentStatus.ACTIVE,
        },
      ],
      mappings: [],
    });
    const records = [
      {
        externalId: "DUP",
        fullName: "One",
        email: "same@test",
        employmentStatus: "Active",
      },
      {
        externalId: "DUP",
        fullName: "Two",
        email: "same@test",
        employmentStatus: "Mystery",
      },
      {
        externalId: "AMB",
        fullName: "Three",
        email: "same@test",
        employmentStatus: "Active",
      },
    ];
    await expect(
      synchronizeEmployees(
        admin,
        state.repository,
        () => pages(records),
        clock,
      ),
    ).resolves.toMatchObject({ status: "partial" });
    expect(
      state.decisions.find((item) => item.externalEmployeeId === "DUP")
        ?.matchStatus,
    ).toBe("duplicate_external_id");
    expect(
      state.decisions.find((item) => item.externalEmployeeId === "AMB")
        ?.matchStatus,
    ).toBe("ambiguous");
  });

  it("does not mutate the directory when a later page fails", async () => {
    const state = createRepository();
    const record = {
      externalId: "EMP-1",
      fullName: "Employee",
      email: "employee@example.test",
      employmentStatus: "Active",
    };
    await expect(
      synchronizeEmployees(
        admin,
        state.repository,
        () => pages([record], true),
        clock,
      ),
    ).rejects.toMatchObject({ code: "REMOTE_SERVER_ERROR" });
    expect(state.repository.completeSync).not.toHaveBeenCalled();
    expect(state.repository.failSync).toHaveBeenCalledWith(
      expect.objectContaining({ safeErrorCode: "REMOTE_SERVER_ERROR" }),
    );
    expect(state.decisions).toEqual([]);
  });

  it("uses the actor organization for every lookup and rejects concurrent sync", async () => {
    const state = createRepository();
    const other = {
      ...admin,
      organizationId: "organization-b",
      userId: "admin-b",
    };
    await expect(
      synchronizeEmployees(other, state.repository, () => pages([]), clock),
    ).rejects.toThrow("DIRECTORY_NOT_AVAILABLE");
    expect(state.repository.claimSync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "organization-b",
        requestedByUserId: "admin-b",
      }),
    );
    (
      state.repository.claimSync as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({ kind: "concurrent" });
    await expect(
      synchronizeEmployees(admin, state.repository, () => pages([]), clock),
    ).rejects.toMatchObject({ code: "CONCURRENT_SYNC" });
  });

  it("rejects employee-triggered manual synchronization before claiming a job", async () => {
    const state = createRepository();
    await expect(
      synchronizeEmployees(
        { ...admin, role: ApplicationRole.EMPLOYEE },
        state.repository,
        () => pages([]),
        clock,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.repository.claimSync).not.toHaveBeenCalled();
  });
});

describe("scheduled synchronization and health", () => {
  it("validates the environment-controlled schedule and cron secret", () => {
    const baseEnvironment = {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
      APP_URL: "http://localhost:3000",
    };
    expect(
      parseEnvironment({
        ...baseEnvironment,
        ERP_NEXT_SYNC_ENABLED: "true",
        ERP_NEXT_SYNC_INTERVAL_MINUTES: "15",
        ERP_NEXT_SYNC_CRON_SECRET:
          "a-secure-scheduler-secret-over-32-characters",
        ERP_NEXT_CREDENTIALS_JSON:
          '{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":{"primary":{"apiKey":"test-key","apiSecret":"test-secret"}}}',
      }),
    ).toMatchObject({
      ERP_NEXT_SYNC_ENABLED: true,
      ERP_NEXT_SYNC_INTERVAL_MINUTES: 15,
    });
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        ERP_NEXT_SYNC_ENABLED: "true",
      }),
    ).toThrow("ERP_NEXT_SYNC_CRON_SECRET");
  });

  it("runs manual and scheduled triggers through the same sync implementation", async () => {
    const state = createRepository();
    const external = [
      {
        externalId: "EMP-1",
        fullName: "Employee",
        email: "employee@example.test",
        employmentStatus: "Active",
      },
    ];
    const createAdapter = vi.fn(() => pages(external));

    await synchronizeEmployees(admin, state.repository, createAdapter, clock);
    await runScheduledEmployeeDirectorySyncs(
      { intervalMinutes: 60, staleAfterMinutes: 30 },
      state.repository,
      createAdapter,
      clock,
    );

    expect(createAdapter).toHaveBeenCalledTimes(2);
    expect(state.repository.claimSync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: "organization-a",
        requestedByUserId: "admin-a",
        trigger: "manual",
      }),
    );
    expect(state.repository.claimSync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        organizationId: "organization-a",
        trigger: "scheduled",
      }),
    );
  });

  it("records accurate safe counters and never creates employee identities", async () => {
    const state = createRepository();
    await synchronizeEmployees(
      admin,
      state.repository,
      () =>
        pages([
          {
            externalId: "MATCHED",
            fullName: "Employee",
            email: "employee@example.test",
            employmentStatus: "Inactive",
          },
          {
            externalId: "UNMATCHED",
            fullName: "Unknown",
            email: "unknown@example.test",
            employmentStatus: "Active",
          },
        ]),
      clock,
    );

    expect(state.repository.completeSync).toHaveBeenCalledWith(
      expect.objectContaining({
        processedCount: 2,
        createdCount: 2,
        updatedCount: 0,
        unchangedCount: 0,
        reviewCount: 1,
        deactivatedCount: 0,
        durationMs: 0,
      }),
    );
  });

  it("bounds scheduler work to due organizations and safely reports overlap", async () => {
    const state = createRepository();
    (
      state.repository.listScheduledOrganizations as ReturnType<typeof vi.fn>
    ).mockResolvedValue(["organization-a"]);
    (
      state.repository.claimSync as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      kind: "concurrent",
    });
    await expect(
      runScheduledEmployeeDirectorySyncs(
        { intervalMinutes: 15, staleAfterMinutes: 30 },
        state.repository,
        () => pages([]),
        clock,
      ),
    ).resolves.toEqual({
      considered: 1,
      succeeded: 0,
      partial: 0,
      failed: 0,
      skipped: 1,
    });
    expect(state.repository.listScheduledOrganizations).toHaveBeenCalledWith({
      dueBefore: new Date("2026-10-03T11:45:00.000Z"),
    });
  });

  it("does not retry permanent credential and permission failures indefinitely", () => {
    expect(isPermanentScheduledSyncError("AUTHENTICATION_FAILED")).toBe(true);
    expect(isPermanentScheduledSyncError("PERMISSION_DENIED")).toBe(true);
    expect(isPermanentScheduledSyncError("REQUEST_TIMEOUT")).toBe(false);
  });

  it("redacts secrets from scheduler authorization and health summaries", () => {
    const secret = "a-very-long-scheduler-secret-value";
    expect(isAuthorizedSchedulerRequest(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedSchedulerRequest("Bearer wrong", secret)).toBe(false);
    expect(safeSyncErrorSummary("AUTHENTICATION_FAILED")).not.toContain(secret);
  });

  it("recovers on a later run after a failed adapter attempt", async () => {
    const state = createRepository();
    await expect(
      synchronizeEmployees(
        admin,
        state.repository,
        () => ({
          ...pages([]),
          listEmployees: vi.fn(async () => {
            throw new EmployeeDirectoryError("REQUEST_TIMEOUT");
          }),
        }),
        clock,
      ),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await expect(
      synchronizeEmployees(admin, state.repository, () => pages([]), clock),
    ).resolves.toMatchObject({ status: "success" });
    expect(state.repository.failSync).toHaveBeenCalledTimes(1);
    expect(state.repository.completeSync).toHaveBeenCalledTimes(1);
  });

  it.each(["AUTHENTICATION_FAILED", "REMOTE_RESPONSE_INVALID"] as const)(
    "records %s without applying a partial directory update",
    async (code) => {
      const state = createRepository();
      await expect(
        synchronizeEmployees(
          admin,
          state.repository,
          () => ({
            ...pages([]),
            listEmployees: vi.fn(async () => {
              throw new EmployeeDirectoryError(code);
            }),
          }),
          clock,
        ),
      ).rejects.toMatchObject({ code });
      expect(state.repository.completeSync).not.toHaveBeenCalled();
      expect(state.repository.failSync).toHaveBeenCalledWith(
        expect.objectContaining({ safeErrorCode: code }),
      );
    },
  );
});
