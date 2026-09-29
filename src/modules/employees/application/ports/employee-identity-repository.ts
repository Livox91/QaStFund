export type EmployeeIdentityRecord = Readonly<{
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  walletAddress: string | null;
  walletStatus: "PENDING" | "ACTIVE" | "FAILED" | null;
  employmentStatus: "ACTIVE" | "SUSPENDED" | "TERMINATED";
  createdAt: Date;
  updatedAt: Date;
}>;

export interface EmployeeIdentityRepository {
  findForEmployee(input: {
    organizationId: string;
    userId: string;
  }): Promise<EmployeeIdentityRecord | null>;
}
