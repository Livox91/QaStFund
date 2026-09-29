import type { Address } from "viem";

export type EmployeeWalletStatus =
  "not_created" | "creating" | "ready" | "error";

export type EmploymentStatus = "active" | "suspended" | "terminated";

export type Employee = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  email: string;
  walletAddress?: Address;
  walletStatus: EmployeeWalletStatus;
  employmentStatus: EmploymentStatus;
  createdAt: Date;
  updatedAt: Date;
}>;
