import { getAddress } from "viem";

import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type {
  EmployeeIdentityRecord,
  EmployeeIdentityRepository,
} from "@/modules/employees/application/ports/employee-identity-repository";
import type {
  Employee,
  EmployeeWalletStatus,
} from "@/modules/employees/domain/employee";
import { ApplicationError } from "@/shared/errors/application-error";

function mapWalletStatus(record: EmployeeIdentityRecord): EmployeeWalletStatus {
  if (!record.walletStatus) return "not_created";
  if (record.walletStatus === "PENDING") return "creating";
  if (record.walletStatus === "FAILED") return "error";
  return record.walletAddress ? "ready" : "error";
}

export async function getEmployeeIdentity(
  actor: AuthenticatedActor | null,
  repository: EmployeeIdentityRepository,
): Promise<Employee> {
  const employee = requireEmployee(actor);
  const record = await repository.findForEmployee({
    organizationId: employee.organizationId,
    userId: employee.userId,
  });

  if (!record) {
    throw new ApplicationError(
      "EMPLOYEE_IDENTITY_NOT_FOUND",
      "The employee identity was not found.",
      404,
    );
  }

  return {
    id: record.userId,
    organizationId: record.organizationId,
    name: record.name,
    email: record.email,
    ...(record.walletAddress
      ? {
          walletAddress: getAddress(
            record.walletAddress,
          ).toLowerCase() as `0x${string}`,
        }
      : {}),
    walletStatus: mapWalletStatus(record),
    employmentStatus:
      record.employmentStatus.toLowerCase() as Employee["employmentStatus"],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
