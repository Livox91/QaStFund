import type { LendingPolicyValues } from "@/modules/policies/domain/lending-policy";

export type EmployerOnboardingSnapshot = {
  organization: {
    id: string;
    name: string;
    slug: string;
    erpNextEnabled: boolean;
  };
  administrator: { name: string; email: string };
  activeEmployerAdminCount: number;
  employeeCount: number;
  policy: LendingPolicyValues | null;
  erpNext: null | {
    connectionStatus: "not_tested" | "connected" | "failed";
    lastSuccessfulSyncAt: Date | null;
    latestSync: null | {
      status: "running" | "success" | "partial" | "failed";
      processedCount: number;
      createdCount: number;
      updatedCount: number;
      deactivatedCount: number;
      reactivatedCount: number;
      reviewCount: number;
      invitationCreatedCount: number;
      invitationSentCount: number;
      invitationFailureCount: number;
      safeErrorSummary: string | null;
      startedAt: Date;
    };
  };
};

export interface EmployerOnboardingRepository {
  getSnapshot(input: {
    organizationId: string;
    actorUserId: string;
  }): Promise<EmployerOnboardingSnapshot | null>;
  updateOrganizationName(input: {
    organizationId: string;
    actorUserId: string;
    name: string;
  }): Promise<boolean>;
  setErpNextEnabled(input: {
    organizationId: string;
    actorUserId: string;
    enabled: boolean;
  }): Promise<boolean>;
}
