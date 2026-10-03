import type { EmploymentStatus } from "@/generated/prisma/client";
import type { EmployeeDirectoryConfig } from "@/modules/employee-directory/domain/employee-directory";
import type { EmployeeDirectorySyncTrigger } from "@/modules/employee-directory/domain/employee-directory";

export type StoredDirectoryIntegration = EmployeeDirectoryConfig & {
  id: string;
  provider: "erpnext";
  connectionStatus: "not_tested" | "connected" | "failed";
  lastConnectionCode: string | null;
  lastTestedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastSyncStatus: "running" | "success" | "partial" | "failed" | null;
  lastSyncErrorCode: string | null;
  scheduledSyncPausedAt: Date | null;
  schedulePauseCode: string | null;
  statusMapping: Readonly<Record<string, EmploymentStatus | null>>;
};

export type DirectorySyncDecision = {
  externalEmployeeId: string;
  employeeCode?: string;
  fullName: string;
  email?: string;
  externalStatus: string;
  normalizedStatus?: EmploymentStatus;
  matchStatus: "matched" | "unmatched" | "ambiguous" | "duplicate_external_id";
  matchMethod?: "unique_email" | "explicit";
  matchedMembershipId?: string;
};

export interface EmployeeDirectoryRepository {
  getIntegration(
    organizationId: string,
  ): Promise<StoredDirectoryIntegration | null>;
  saveIntegration(
    input: EmployeeDirectoryConfig & {
      statusMapping: Readonly<Record<string, EmploymentStatus | null>>;
    },
  ): Promise<void>;
  recordConnectionResult(input: {
    organizationId: string;
    ok: boolean;
    code: string;
    testedAt: Date;
  }): Promise<void>;
  claimSync(input: {
    organizationId: string;
    requestedByUserId?: string;
    trigger: EmployeeDirectorySyncTrigger;
    correlationId: string;
    startedAt: Date;
    staleBefore: Date;
  }): Promise<
    | { kind: "missing" }
    | { kind: "unauthorized" }
    | { kind: "concurrent" }
    | {
        kind: "claimed";
        runId: string;
        integration: StoredDirectoryIntegration;
      }
  >;
  getMatchContext(organizationId: string): Promise<{
    employees: ReadonlyArray<{
      membershipId: string;
      email: string;
      status: EmploymentStatus;
    }>;
    mappings: ReadonlyArray<{
      externalEmployeeId: string;
      matchedMembershipId: string;
    }>;
  }>;
  completeSync(input: {
    organizationId: string;
    runId: string;
    decisions: ReadonlyArray<DirectorySyncDecision>;
    retrievedCount: number;
    processedCount: number;
    createdCount: number;
    updatedCount: number;
    unchangedCount: number;
    reviewCount: number;
    statusChangeCount: number;
    errorCount: number;
    status: "success" | "partial";
    safeErrorCode?: string;
    safeErrorSummary?: string;
    completedAt: Date;
    durationMs: number;
  }): Promise<void>;
  failSync(input: {
    organizationId: string;
    runId: string;
    safeErrorCode: string;
    safeErrorSummary: string;
    completedAt: Date;
    durationMs: number;
  }): Promise<void>;
  listScheduledOrganizations(input: {
    dueBefore: Date;
  }): Promise<ReadonlyArray<string>>;
  getDashboard(organizationId: string): Promise<EmployeeDirectoryDashboard>;
}

export type EmployeeDirectoryDashboard = {
  configured: boolean;
  integration: null | {
    baseUrl: string;
    apiPath: string;
    apiVersion: string;
    authMethod: "token" | "oauth_bearer";
    credentialConfigured: boolean;
    timeoutMs: number;
    connectionStatus: "not_tested" | "connected" | "failed";
    lastConnectionCode: string | null;
    lastTestedAt: Date | null;
    lastSuccessfulSyncAt: Date | null;
    lastSyncStatus: "running" | "success" | "partial" | "failed" | null;
    lastSyncErrorCode: string | null;
    scheduledSyncPausedAt: Date | null;
    schedulePauseCode: string | null;
    statusMapping: Readonly<Record<string, EmploymentStatus | null>>;
  };
  latestRun: null | {
    id: string;
    trigger: EmployeeDirectorySyncTrigger;
    status: "running" | "success" | "partial" | "failed";
    processedCount: number;
    createdCount: number;
    updatedCount: number;
    unchangedCount: number;
    reviewCount: number;
    retrievedCount: number;
    matchedCount: number;
    unmatchedCount: number;
    ambiguousCount: number;
    statusChangeCount: number;
    errorCount: number;
    safeErrorCode: string | null;
    safeErrorSummary: string | null;
    correlationId: string;
    startedAt: Date;
    completedAt: Date | null;
    durationMs: number | null;
  };
  history: ReadonlyArray<{
    id: string;
    trigger: EmployeeDirectorySyncTrigger;
    status: "running" | "success" | "partial" | "failed";
    processedCount: number;
    createdCount: number;
    updatedCount: number;
    unchangedCount: number;
    reviewCount: number;
    retrievedCount: number;
    matchedCount: number;
    unmatchedCount: number;
    ambiguousCount: number;
    errorCount: number;
    startedAt: Date;
    durationMs: number | null;
  }>;
  reviewRecords: ReadonlyArray<{
    externalEmployeeId: string;
    employeeCode: string | null;
    fullName: string;
    email: string | null;
    externalStatus: string;
    matchStatus:
      "matched" | "unmatched" | "ambiguous" | "duplicate_external_id";
    statusMapped: boolean;
    lastSynchronizedAt: Date;
  }>;
  schedule?: {
    enabled: boolean;
    intervalMinutes: number;
    nextScheduledSyncAt: Date | null;
    pausedCode: string | null;
  };
};
