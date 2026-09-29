import { describe, expect, it, vi } from "vitest";

import {
  ForbiddenError,
  UnauthenticatedError,
} from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { markOverdueLoans } from "@/modules/loans/application/mark-overdue-loans";
import type { LoanLifecycleRepository } from "@/modules/loans/application/ports/loan-lifecycle-repository";
import { shouldMarkLoanOverdue } from "@/modules/loans/domain/loan-lifecycle";

const now = new Date("2026-09-29T12:00:00.000Z");
const admin: AuthenticatedActor = {
  userId: "admin-a",
  email: "admin@organization-a.test",
  name: "Admin A",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

function createRepository(): LoanLifecycleRepository {
  return { markOverdue: vi.fn(async () => 2) };
}

describe("overdue loan lifecycle", () => {
  it("marks only active, past-due loans with a remaining balance", () => {
    expect(
      shouldMarkLoanOverdue({
        status: "ACTIVE",
        dueAt: new Date("2026-09-28T12:00:00.000Z"),
        remainingBalanceMinorUnits: 1n,
        now,
      }),
    ).toBe(true);

    for (const candidate of [
      { status: "REPAID" as const, remainingBalanceMinorUnits: 1n },
      { status: "ACTIVE" as const, remainingBalanceMinorUnits: 0n },
    ]) {
      expect(
        shouldMarkLoanOverdue({
          ...candidate,
          dueAt: new Date("2026-09-28T12:00:00.000Z"),
          now,
        }),
      ).toBe(false);
    }

    expect(
      shouldMarkLoanOverdue({
        status: "ACTIVE",
        dueAt: now,
        remainingBalanceMinorUnits: 1n,
        now,
      }),
    ).toBe(false);
  });

  it("derives the organization scope from an employer admin", async () => {
    const repository = createRepository();

    await expect(markOverdueLoans(admin, repository, now)).resolves.toBe(2);
    expect(repository.markOverdue).toHaveBeenCalledWith({
      organizationId: "organization-a",
      actorUserId: "admin-a",
      now,
    });
  });

  it("rejects unauthenticated users and employees before repository access", async () => {
    const repository = createRepository();

    await expect(
      markOverdueLoans(null, repository, now),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      markOverdueLoans(
        { ...admin, role: ApplicationRole.EMPLOYEE },
        repository,
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.markOverdue).not.toHaveBeenCalled();
  });
});
