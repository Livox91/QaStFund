import { describe, expect, it, vi } from "vitest";

import { ApplicationRole } from "@/modules/auth/domain/application-role";
import {
  investigateLoanOperations,
  type LoanInvestigationRepository,
} from "@/modules/operations/application/loan-investigation";
import { sanitizeOperationalEvidence } from "@/modules/operations/infrastructure/safe-operational-evidence";

const employer = {
  userId: "10000000-0000-4000-8000-000000000001",
  email: "operator@example.test",
  name: "Operator",
  organizationId: "20000000-0000-4000-8000-000000000001",
  organizationName: "Acme",
  organizationSlug: "acme",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

describe("operator loan investigation", () => {
  it("enforces employer-admin access and organization scope", async () => {
    const repository: LoanInvestigationRepository = {
      findOperationalTrace: vi.fn(async () => ({ loan: { id: "loan-id" } })),
    };
    await investigateLoanOperations(employer, "loan-id", repository);
    expect(repository.findOperationalTrace).toHaveBeenCalledWith({
      organizationId: employer.organizationId,
      loanId: "loan-id",
    });

    await expect(
      investigateLoanOperations(
        { ...employer, role: ApplicationRole.EMPLOYEE },
        "loan-id",
        repository,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.findOperationalTrace).toHaveBeenCalledTimes(1);
  });

  it("redacts secrets, personal data, and wallet addresses from evidence", () => {
    const safe = sanitizeOperationalEvidence({
      email: "employee@example.test",
      borrowerName: "Employee One",
      accessToken: "super-secret-token",
      borrower: "0x1111111111111111111111111111111111111111",
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("employee@example.test");
    expect(serialized).not.toContain("Employee One");
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain(
      "0x1111111111111111111111111111111111111111",
    );
    expect(serialized).toContain(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });
});
