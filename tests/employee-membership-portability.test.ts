import { describe, expect, it } from "vitest";

import { canProvisionEmployeeInOrganization } from "@/modules/employee-directory/domain/membership-portability";

describe("employee membership portability", () => {
  it("allows a former employee to join a new organization", () => {
    expect(
      canProvisionEmployeeInOrganization(
        [
          {
            organizationId: "organization-a",
            role: "EMPLOYEE",
            isActive: false,
          },
        ],
        "organization-b",
      ),
    ).toBe(true);
  });

  it("does not silently place an active account into a second organization", () => {
    expect(
      canProvisionEmployeeInOrganization(
        [
          {
            organizationId: "organization-a",
            role: "EMPLOYEE",
            isActive: true,
          },
        ],
        "organization-b",
      ),
    ).toBe(false);
  });

  it("does not create a duplicate membership in the same organization", () => {
    expect(
      canProvisionEmployeeInOrganization(
        [
          {
            organizationId: "organization-b",
            role: "EMPLOYEE",
            isActive: false,
          },
        ],
        "organization-b",
      ),
    ).toBe(false);
  });
});
