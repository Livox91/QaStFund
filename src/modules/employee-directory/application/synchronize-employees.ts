import { randomUUID } from "node:crypto";

import { EmploymentStatus } from "@/generated/prisma/client";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type {
  DirectorySyncDecision,
  EmployeeDirectoryRepository,
  StoredDirectoryIntegration,
} from "@/modules/employee-directory/application/ports/employee-directory-repository";
import { safeSyncErrorSummary } from "@/modules/employee-directory/application/sync-health";
import {
  EmployeeDirectoryError,
  type EmployeeDirectoryAdapter,
  type EmployeeDirectorySyncTrigger,
  type ExternalEmployee,
} from "@/modules/employee-directory/domain/employee-directory";
import type { Clock } from "@/shared/time/clock";

export type EmployeeDirectoryAdapterFactory = (
  config: StoredDirectoryIntegration,
) => EmployeeDirectoryAdapter;

type SyncRequest = {
  organizationId: string;
  requestedByUserId?: string;
  trigger: EmployeeDirectorySyncTrigger;
  staleAfterMs: number;
  maxPages?: number;
};

function normalizeStatus(
  externalStatus: string,
  mapping: Readonly<Record<string, EmploymentStatus | null>>,
): EmploymentStatus | undefined {
  return mapping[externalStatus.trim().toLowerCase()] ?? undefined;
}

function elapsedMilliseconds(startedAt: Date, completedAt: Date): number {
  return Math.max(
    0,
    Math.min(2_147_483_647, completedAt.getTime() - startedAt.getTime()),
  );
}

export async function synchronizeEmployees(
  actor: AuthenticatedActor | null,
  repository: EmployeeDirectoryRepository,
  createAdapter: EmployeeDirectoryAdapterFactory,
  clock: Clock,
  options: { staleAfterMs?: number; maxPages?: number } = {},
) {
  const employer = requireEmployerAdmin(actor);
  return await synchronizeOrganizationEmployees(
    {
      organizationId: employer.organizationId,
      requestedByUserId: employer.userId,
      trigger: "manual",
      staleAfterMs: options.staleAfterMs ?? 30 * 60_000,
      maxPages: options.maxPages,
    },
    repository,
    createAdapter,
    clock,
  );
}

export async function synchronizeOrganizationEmployees(
  request: SyncRequest,
  repository: EmployeeDirectoryRepository,
  createAdapter: EmployeeDirectoryAdapterFactory,
  clock: Clock,
) {
  const startedAt = clock.now();
  const claim = await repository.claimSync({
    organizationId: request.organizationId,
    ...(request.requestedByUserId
      ? { requestedByUserId: request.requestedByUserId }
      : {}),
    trigger: request.trigger,
    correlationId: randomUUID(),
    startedAt,
    staleBefore: new Date(startedAt.getTime() - request.staleAfterMs),
  });
  if (claim.kind === "concurrent") {
    throw new EmployeeDirectoryError("CONCURRENT_SYNC");
  }
  if (claim.kind !== "claimed") throw new Error("DIRECTORY_NOT_AVAILABLE");

  const records: ExternalEmployee[] = [];
  let cursor: string | undefined;
  try {
    const adapter = createAdapter(claim.integration);
    let pageCount = 0;
    do {
      if (pageCount >= (request.maxPages ?? 100)) {
        throw new EmployeeDirectoryError("SYNC_LIMIT_EXCEEDED");
      }
      const page = await adapter.listEmployees(cursor);
      records.push(...page.employees);
      cursor = page.nextCursor;
      pageCount += 1;
    } while (cursor);

    const context = await repository.getMatchContext(request.organizationId);
    const employeesByEmail = new Map<string, typeof context.employees>();
    for (const employee of context.employees) {
      const email = employee.email.trim().toLowerCase();
      employeesByEmail.set(email, [
        ...(employeesByEmail.get(email) ?? []),
        employee,
      ]);
    }
    const mappingsByExternalId = new Map(
      context.mappings.map((mapping) => [mapping.externalEmployeeId, mapping]),
    );
    const duplicateIds = new Set<string>();
    const seenIds = new Set<string>();
    for (const record of records) {
      if (seenIds.has(record.externalId)) duplicateIds.add(record.externalId);
      seenIds.add(record.externalId);
    }
    let unknownStatusCount = 0;
    let decisions: DirectorySyncDecision[] = records.map((record) => {
      const normalizedStatus = normalizeStatus(
        record.employmentStatus,
        claim.integration.statusMapping,
      );
      if (!normalizedStatus) unknownStatusCount += 1;
      const base = {
        externalEmployeeId: record.externalId,
        ...(record.employeeCode ? { employeeCode: record.employeeCode } : {}),
        fullName: record.fullName,
        ...(record.email ? { email: record.email } : {}),
        externalStatus: record.employmentStatus,
        ...(normalizedStatus ? { normalizedStatus } : {}),
      };
      if (duplicateIds.has(record.externalId)) {
        return { ...base, matchStatus: "duplicate_external_id" };
      }
      const mappedMembershipId = mappingsByExternalId.get(
        record.externalId,
      )?.matchedMembershipId;
      const existingMapping = mappingsByExternalId.get(record.externalId);
      const candidates = record.email
        ? (employeesByEmail.get(record.email.trim().toLowerCase()) ?? [])
        : [];
      const mappedEmployee = mappedMembershipId
        ? context.employees.find(
            (employee) => employee.membershipId === mappedMembershipId,
          )
        : undefined;
      if (mappedEmployee) {
        return {
          ...base,
          matchStatus: "matched",
          matchMethod: existingMapping?.matchMethod ?? "explicit",
          matchedMembershipId: mappedEmployee.membershipId,
        };
      }
      if (candidates.length === 1) {
        return {
          ...base,
          matchStatus: "matched",
          matchMethod: "unique_email",
          matchedMembershipId: candidates[0].membershipId,
        };
      }
      return {
        ...base,
        matchStatus: candidates.length > 1 ? "ambiguous" : "unmatched",
      };
    });
    const membershipCounts = new Map<string, number>();
    for (const decision of decisions) {
      if (decision.matchedMembershipId) {
        membershipCounts.set(
          decision.matchedMembershipId,
          (membershipCounts.get(decision.matchedMembershipId) ?? 0) + 1,
        );
      }
    }
    decisions = decisions.map((decision) =>
      decision.matchedMembershipId &&
      (membershipCounts.get(decision.matchedMembershipId) ?? 0) > 1
        ? {
            externalEmployeeId: decision.externalEmployeeId,
            ...(decision.employeeCode
              ? { employeeCode: decision.employeeCode }
              : {}),
            fullName: decision.fullName,
            ...(decision.email ? { email: decision.email } : {}),
            externalStatus: decision.externalStatus,
            ...(decision.normalizedStatus
              ? { normalizedStatus: decision.normalizedStatus }
              : {}),
            matchStatus: "ambiguous" as const,
          }
        : decision,
    );
    decisions = [
      ...new Map(
        decisions.map((decision) => [decision.externalEmployeeId, decision]),
      ).values(),
    ];
    const missingDecisions: DirectorySyncDecision[] = context.mappings
      .filter(
        (mapping) =>
          mapping.matchedMembershipId &&
          !seenIds.has(mapping.externalEmployeeId),
      )
      .map((mapping) => {
        const currentStatus = context.employees.find(
          (employee) => employee.membershipId === mapping.matchedMembershipId,
        )?.status;
        return {
          externalEmployeeId: mapping.externalEmployeeId,
          ...(mapping.employeeCode
            ? { employeeCode: mapping.employeeCode }
            : {}),
          fullName: mapping.fullName,
          ...(mapping.email ? { email: mapping.email } : {}),
          externalStatus: "Missing from ERPNext",
          normalizedStatus:
            currentStatus === EmploymentStatus.TERMINATED
              ? EmploymentStatus.TERMINATED
              : EmploymentStatus.SUSPENDED,
          matchStatus: "matched" as const,
          matchMethod: "explicit" as const,
          matchedMembershipId: mapping.matchedMembershipId!,
        };
      });
    decisions.push(...missingDecisions);
    const statusChangeCount = decisions.reduce((count, decision) => {
      if (!decision.matchedMembershipId || !decision.normalizedStatus)
        return count;
      const employee = context.employees.find(
        (candidate) => candidate.membershipId === decision.matchedMembershipId,
      );
      return count + (employee?.status !== decision.normalizedStatus ? 1 : 0);
    }, 0);
    const deactivatedCount = missingDecisions.reduce((count, decision) => {
      const employee = context.employees.find(
        (candidate) => candidate.membershipId === decision.matchedMembershipId,
      );
      return count + (employee?.status === EmploymentStatus.ACTIVE ? 1 : 0);
    }, 0);
    const reviewCount = decisions.filter(
      (decision) =>
        decision.matchStatus !== "matched" || !decision.normalizedStatus,
    ).length;
    const changed = (decision: DirectorySyncDecision) => {
      const previous = mappingsByExternalId.get(decision.externalEmployeeId);
      return (
        !previous ||
        previous.employeeCode !== (decision.employeeCode ?? null) ||
        previous.fullName !== decision.fullName ||
        previous.email !== (decision.email ?? null) ||
        previous.externalStatus !== decision.externalStatus ||
        previous.normalizedStatus !== (decision.normalizedStatus ?? null) ||
        previous.matchStatus !== decision.matchStatus ||
        previous.matchMethod !== (decision.matchMethod ?? null) ||
        previous.matchedMembershipId !== (decision.matchedMembershipId ?? null)
      );
    };
    const createdCount = decisions.filter(
      (decision) => !mappingsByExternalId.has(decision.externalEmployeeId),
    ).length;
    const updatedCount = decisions.filter(
      (decision) =>
        mappingsByExternalId.has(decision.externalEmployeeId) &&
        changed(decision),
    ).length;
    const unchangedCount = decisions.length - createdCount - updatedCount;
    const errorCount = unknownStatusCount + duplicateIds.size;
    const status = errorCount > 0 ? "partial" : "success";
    const completedAt = clock.now();
    await repository.completeSync({
      organizationId: request.organizationId,
      runId: claim.runId,
      decisions,
      retrievedCount: records.length,
      processedCount: records.length,
      createdCount,
      updatedCount,
      unchangedCount,
      reviewCount,
      statusChangeCount,
      deactivatedCount,
      errorCount,
      status,
      ...(status === "partial"
        ? {
            safeErrorCode: "PARTIAL_SYNC",
            safeErrorSummary: safeSyncErrorSummary("PARTIAL_SYNC"),
          }
        : {}),
      completedAt,
      durationMs: elapsedMilliseconds(startedAt, completedAt),
    });
    return {
      status,
      processedCount: records.length,
      reviewCount,
      createdCount,
      updatedCount,
      deactivatedCount,
    };
  } catch (error) {
    const safeErrorCode =
      error instanceof EmployeeDirectoryError ? error.code : "UNEXPECTED_ERROR";
    const completedAt = clock.now();
    await repository.failSync({
      organizationId: request.organizationId,
      runId: claim.runId,
      safeErrorCode,
      safeErrorSummary: safeSyncErrorSummary(safeErrorCode),
      completedAt,
      durationMs: elapsedMilliseconds(startedAt, completedAt),
    });
    throw error;
  }
}
