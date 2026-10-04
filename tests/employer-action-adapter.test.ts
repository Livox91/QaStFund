import { describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "@/infrastructure/config/environment-schema";
import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import {
  EmployerActionNotAllowedError,
  EmployerActionTargetNotFoundError,
} from "@/modules/employer-actions/application/errors";
import { executeEmployerAction } from "@/modules/employer-actions/application/execute-employer-action";
import type {
  EmployerActionContext,
  EmployerActionRepository,
} from "@/modules/employer-actions/application/ports/employer-action-repository";
import type {
  EmployerActionAttempt,
  EmployerActionType,
} from "@/modules/employer-actions/domain/employer-action";
import { MockEmployerActionAdapter } from "@/modules/employer-actions/infrastructure/mock-employer-action-adapter";
import { RuleBasedDecisionAdapter } from "@/modules/loan-decisions/infrastructure/rule-based-decision-adapter";
import type { Clock } from "@/shared/time/clock";

const loanId = "20000000-0000-4000-8000-000000000001";
const firstKey = "50000000-0000-4000-8000-000000000001";
const secondKey = "50000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-09T12:00:00.000Z");
const fixedClock: Clock = { now: () => now };

const admin: AuthenticatedActor = {
  userId: "admin-a",
  email: "admin@organization-a.test",
  name: "Admin A",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

function createRepository(
  contextOverrides: Partial<EmployerActionContext> = {},
): EmployerActionRepository & {
  attempts: EmployerActionAttempt[];
  context: EmployerActionContext;
} {
  const attempts: EmployerActionAttempt[] = [];
  const context: EmployerActionContext = {
    evaluationId: "evaluation-a",
    classification: "default_candidate",
    financialStatus: "ACTIVE",
    reviewedAt: null,
    ...contextOverrides,
  };
  return {
    attempts,
    context,
    findContext: vi.fn(async ({ organizationId, requestedByUserId }) =>
      organizationId === "organization-a" && requestedByUserId === "admin-a"
        ? context
        : null,
    ),
    findByIdempotencyKey: vi.fn(
      async ({ organizationId, idempotencyKey, requestedByUserId }) =>
        organizationId === "organization-a" && requestedByUserId === "admin-a"
          ? (attempts.find((item) => item.idempotencyKey === idempotencyKey) ??
            null)
          : null,
    ),
    claimAttempt: vi.fn(async (input) => {
      if (
        input.organizationId !== "organization-a" ||
        input.requestedByUserId !== "admin-a"
      ) {
        return null;
      }
      const existing = attempts.find(
        (item) => item.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return { kind: "EXISTING", attempt: existing } as const;
      const attempt: EmployerActionAttempt = {
        id: `attempt-${attempts.length + 1}`,
        loanId: input.loanId,
        action: input.action,
        status: "pending",
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
        adapterActionId: null,
        messageCode: "ACTION_PENDING",
        requestedByUserId: "admin-a",
        requestedByName: "Admin A",
        requestedAt: input.requestedAt,
        completedAt: null,
      };
      attempts.push(attempt);
      return { kind: "CLAIMED", attempt } as const;
    }),
    completeAttempt: vi.fn(async ({ attemptId, result, completedAt }) => {
      const index = attempts.findIndex((item) => item.id === attemptId);
      const current = attempts[index];
      if (!current) throw new Error("Missing fake attempt");
      const completed: EmployerActionAttempt = {
        ...current,
        status: result.status,
        adapterActionId: result.actionId,
        messageCode: result.messageCode,
        completedAt: result.status === "pending" ? null : completedAt,
      };
      attempts[index] = completed;
      if (current.action === "mark_reviewed" && result.status === "completed") {
        (context as { reviewedAt: Date | null }).reviewedAt = completedAt;
      }
      return completed;
    }),
    listForLoan: vi.fn(async ({ organizationId, requestedByUserId }) =>
      organizationId === "organization-a" && requestedByUserId === "admin-a"
        ? attempts
        : null,
    ),
  };
}

function execute(
  repository: EmployerActionRepository,
  adapter: MockEmployerActionAdapter,
  action: EmployerActionType,
  idempotencyKey = firstKey,
  actor: AuthenticatedActor = admin,
) {
  return executeEmployerAction(
    actor,
    { loanId, action, idempotencyKey },
    adapter,
    "mock",
    repository,
    fixedClock,
  );
}

describe("mock employer action adapter", () => {
  it("lets an authorized employer mark a loan reviewed without changing finance state", async () => {
    const repository = createRepository();
    const result = await execute(
      repository,
      new MockEmployerActionAdapter(),
      "mark_reviewed",
    );

    expect(result).toMatchObject({
      status: "completed",
      messageCode: "SIMULATED_REVIEW_RECORDED",
    });
    expect(repository.context.reviewedAt).toEqual(now);
    expect(repository.context.financialStatus).toBe("ACTIVE");
  });

  it("rejects employees before an action repository is queried", async () => {
    const repository = createRepository();
    await expect(
      execute(
        repository,
        new MockEmployerActionAdapter(),
        "mark_reviewed",
        firstKey,
        { ...admin, role: ApplicationRole.EMPLOYEE },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.findContext).not.toHaveBeenCalled();
  });

  it("does not expose a loan from another organization", async () => {
    const repository = createRepository();
    await expect(
      execute(
        repository,
        new MockEmployerActionAdapter(),
        "mark_reviewed",
        firstKey,
        { ...admin, organizationId: "organization-b" },
      ),
    ).rejects.toBeInstanceOf(EmployerActionTargetNotFoundError);
    expect(repository.claimAttempt).not.toHaveBeenCalled();
  });

  it("rejects invalid action types with a structured safe result", async () => {
    const adapter = new MockEmployerActionAdapter();
    await expect(
      adapter.execute({
        loanId,
        organizationId: "organization-a",
        requestedBy: "admin-a",
        action: "deduct_salary" as EmployerActionType,
        idempotencyKey: firstKey,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      messageCode: "UNSUPPORTED_ACTION",
    });
  });

  it("does not execute twice for the same idempotency key", async () => {
    const repository = createRepository();
    const adapter = new MockEmployerActionAdapter();
    const executeSpy = vi.spyOn(adapter, "execute");
    const first = await execute(repository, adapter, "mark_reviewed");
    const repeated = await execute(repository, adapter, "mark_reviewed");

    expect(repeated).toEqual(first);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(repository.attempts).toHaveLength(1);
  });

  it("clearly identifies contact and HR outcomes as simulated", async () => {
    const repository = createRepository({ reviewedAt: now });
    const adapter = new MockEmployerActionAdapter();
    const contact = await execute(
      repository,
      adapter,
      "request_employee_contact",
    );
    const hr = await execute(
      repository,
      adapter,
      "request_hr_follow_up",
      secondKey,
    );

    expect(contact.messageCode).toBe("SIMULATED_EMPLOYEE_CONTACT_REQUESTED");
    expect(hr.messageCode).toBe("SIMULATED_HR_FOLLOW_UP_REQUESTED");
  });

  it("records deterministic failed attempts and retries only with a new key", async () => {
    const repository = createRepository({ reviewedAt: now });
    const adapter = new MockEmployerActionAdapter({
      [firstKey]: "failed",
      [secondKey]: "failed",
    });
    const executeSpy = vi.spyOn(adapter, "execute");
    const failed = await execute(repository, adapter, "request_hr_follow_up");
    const repeated = await execute(repository, adapter, "request_hr_follow_up");
    const retry = await execute(
      repository,
      adapter,
      "request_hr_follow_up",
      secondKey,
    );

    expect(failed.status).toBe("failed");
    expect(repeated).toEqual(failed);
    expect(retry.status).toBe("failed");
    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(repository.attempts).toHaveLength(2);
  });

  it("requires review and an actionable open-loan state", async () => {
    await expect(
      execute(
        createRepository(),
        new MockEmployerActionAdapter(),
        "request_hr_follow_up",
      ),
    ).rejects.toBeInstanceOf(EmployerActionNotAllowedError);
    await expect(
      execute(
        createRepository({ financialStatus: "REPAID", reviewedAt: now }),
        new MockEmployerActionAdapter(),
        "request_hr_follow_up",
      ),
    ).rejects.toBeInstanceOf(EmployerActionNotAllowedError);
  });

  it("does not let a model recommendation invoke the action adapter", async () => {
    const adapter = new MockEmployerActionAdapter();
    const executeSpy = vi.spyOn(adapter, "execute");
    const decision = await new RuleBasedDecisionAdapter().evaluate({
      loanId,
      principalBaseUnits: "100000000",
      repaymentBaseUnits: "105000000",
      startedAt: new Date("2026-09-01T00:00:00.000Z"),
      dueAt: new Date("2026-10-01T00:00:00.000Z"),
      currentTime: now,
      borrower: {
        employeeId: "employee-b",
        organizationId: "organization-a",
        employmentStatus: "active",
      },
      loanStatus: "active",
    });

    expect(decision.classification).toBe("default_candidate");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("defaults to mock and rejects unknown provider configuration", () => {
    const environment = {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
      APP_URL: "http://localhost:3000",
    };
    expect(parseEnvironment(environment).EMPLOYER_ACTION_PROVIDER).toBe("mock");
    expect(() =>
      parseEnvironment({
        ...environment,
        EMPLOYER_ACTION_PROVIDER: "erpnext",
      }),
    ).toThrow("Invalid environment configuration");
  });

  it("does not expose credentials in results or logs", async () => {
    const secret = "erpnext-secret-that-must-not-leak";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await executeEmployerAction(
      admin,
      { loanId, action: "mark_reviewed", idempotencyKey: firstKey },
      {
        execute: vi.fn(async () => {
          throw new Error(secret);
        }),
      },
      "mock",
      createRepository(),
      fixedClock,
    );

    expect(result.messageCode).toBe("ADAPTER_EXECUTION_FAILED");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
