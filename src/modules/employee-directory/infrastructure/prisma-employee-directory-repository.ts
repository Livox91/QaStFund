import {
  EmploymentStatus,
  MembershipRole,
  type Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { generateSecureToken } from "@/modules/auth/domain/secure-token";
import type {
  DirectorySyncDecision,
  EmployeeDirectoryDashboard,
  EmployeeDirectoryRepository,
  InvitationDelivery,
  StoredDirectoryIntegration,
} from "@/modules/employee-directory/application/ports/employee-directory-repository";
import { isPermanentScheduledSyncError } from "@/modules/employee-directory/application/sync-health";
import type { EmployeeDirectoryErrorCode } from "@/modules/employee-directory/domain/employee-directory";

function lower<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

function readStatusMapping(
  value: Prisma.JsonValue,
): Readonly<Record<string, EmploymentStatus | null>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, EmploymentStatus | null> = {};
  for (const [key, status] of Object.entries(value)) {
    if (
      status === null ||
      Object.values(EmploymentStatus).includes(status as EmploymentStatus)
    ) {
      result[key.trim().toLowerCase()] = status as EmploymentStatus | null;
    }
  }
  return result;
}

const integrationSelection = {
  id: true,
  organizationId: true,
  provider: true,
  baseUrl: true,
  apiPath: true,
  apiVersion: true,
  authMethod: true,
  credentialReference: true,
  timeoutMs: true,
  statusMapping: true,
  connectionStatus: true,
  lastConnectionCode: true,
  lastTestedAt: true,
  lastSuccessfulSyncAt: true,
  lastSyncStatus: true,
  lastSyncErrorCode: true,
  scheduledSyncPausedAt: true,
  schedulePauseCode: true,
} as const;

type IntegrationRow = Prisma.EmployeeDirectoryIntegrationGetPayload<{
  select: typeof integrationSelection;
}>;

function toIntegration(row: IntegrationRow): StoredDirectoryIntegration {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: lower(row.provider),
    baseUrl: row.baseUrl,
    apiPath: row.apiPath,
    apiVersion: row.apiVersion,
    authMethod: lower(row.authMethod),
    credentialReference: row.credentialReference,
    timeoutMs: row.timeoutMs,
    statusMapping: readStatusMapping(row.statusMapping),
    connectionStatus: lower(row.connectionStatus),
    lastConnectionCode: row.lastConnectionCode,
    lastTestedAt: row.lastTestedAt,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
    lastSyncStatus: row.lastSyncStatus
      ? lower<"running" | "success" | "partial" | "failed">(row.lastSyncStatus)
      : null,
    lastSyncErrorCode: row.lastSyncErrorCode,
    scheduledSyncPausedAt: row.scheduledSyncPausedAt,
    schedulePauseCode: row.schedulePauseCode,
  };
}

function countDecisions(decisions: ReadonlyArray<DirectorySyncDecision>) {
  return {
    matchedCount: decisions.filter((item) => item.matchStatus === "matched")
      .length,
    unmatchedCount: decisions.filter((item) => item.matchStatus === "unmatched")
      .length,
    ambiguousCount: decisions.filter(
      (item) =>
        item.matchStatus === "ambiguous" ||
        item.matchStatus === "duplicate_external_id",
    ).length,
  };
}

export const prismaEmployeeDirectoryRepository: EmployeeDirectoryRepository = {
  async getIntegration(organizationId) {
    const row = await prisma.employeeDirectoryIntegration.findUnique({
      where: { organizationId },
      select: integrationSelection,
    });
    return row ? toIntegration(row) : null;
  },

  async saveIntegration(input) {
    await prisma.employeeDirectoryIntegration.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        provider: "ERPNEXT",
        baseUrl: input.baseUrl,
        apiPath: input.apiPath,
        apiVersion: input.apiVersion,
        authMethod: input.authMethod.toUpperCase() as "TOKEN" | "OAUTH_BEARER",
        credentialReference: input.credentialReference,
        timeoutMs: input.timeoutMs,
        statusMapping: input.statusMapping,
      },
      update: {
        baseUrl: input.baseUrl,
        apiPath: input.apiPath,
        apiVersion: input.apiVersion,
        authMethod: input.authMethod.toUpperCase() as "TOKEN" | "OAUTH_BEARER",
        credentialReference: input.credentialReference,
        timeoutMs: input.timeoutMs,
        statusMapping: input.statusMapping,
        connectionStatus: "NOT_TESTED",
        lastConnectionCode: null,
      },
    });
  },

  async recordConnectionResult(input) {
    await prisma.employeeDirectoryIntegration.updateMany({
      where: { organizationId: input.organizationId },
      data: {
        connectionStatus: input.ok ? "CONNECTED" : "FAILED",
        lastConnectionCode: input.code,
        lastTestedAt: input.testedAt,
      },
    });
  },

  async claimSync(input) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`employee-directory:${input.organizationId}`}, 0))
      `;
      const membership = input.requestedByUserId
        ? await transaction.organizationMembership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: input.organizationId,
                userId: input.requestedByUserId,
              },
            },
            select: { id: true, role: true, isActive: true },
          })
        : null;
      if (
        input.trigger === "manual" &&
        (!membership?.isActive ||
          membership.role !== MembershipRole.EMPLOYER_ADMIN)
      ) {
        return { kind: "unauthorized" } as const;
      }
      const integration =
        await transaction.employeeDirectoryIntegration.findUnique({
          where: { organizationId: input.organizationId },
          select: integrationSelection,
        });
      if (!integration) return { kind: "missing" } as const;
      const staleRuns = await transaction.employeeDirectorySyncRun.findMany({
        where: {
          organizationId: input.organizationId,
          status: "RUNNING",
          startedAt: { lt: input.staleBefore },
        },
        select: { id: true, startedAt: true },
      });
      for (const staleRun of staleRuns) {
        await transaction.employeeDirectorySyncRun.update({
          where: { id: staleRun.id },
          data: {
            status: "FAILED",
            safeErrorCode: "UNEXPECTED_ERROR",
            safeErrorSummary:
              "The previous synchronization stopped before completion.",
            errorCount: 1,
            completedAt: input.startedAt,
            durationMs: Math.min(
              2_147_483_647,
              input.startedAt.getTime() - staleRun.startedAt.getTime(),
            ),
          },
        });
      }
      const running = await transaction.employeeDirectorySyncRun.findFirst({
        where: { organizationId: input.organizationId, status: "RUNNING" },
        select: { id: true },
      });
      if (running) return { kind: "concurrent" } as const;
      const run = await transaction.employeeDirectorySyncRun.create({
        data: {
          organizationId: input.organizationId,
          integrationId: integration.id,
          requestedByMembershipId: membership?.id,
          trigger: input.trigger.toUpperCase() as "MANUAL" | "SCHEDULED",
          correlationId: input.correlationId,
          startedAt: input.startedAt,
        },
        select: { id: true },
      });
      await transaction.employeeDirectoryIntegration.update({
        where: { id: integration.id },
        data: { lastSyncStatus: "RUNNING", lastSyncErrorCode: null },
      });
      return {
        kind: "claimed",
        runId: run.id,
        integration: toIntegration(integration),
      } as const;
    });
  },

  async listScheduledOrganizations(input) {
    const integrations = await prisma.employeeDirectoryIntegration.findMany({
      where: {
        scheduledSyncPausedAt: null,
        organization: { erpNextEnabled: true },
        OR: [
          { syncRuns: { none: {} } },
          { syncRuns: { none: { startedAt: { gt: input.dueBefore } } } },
        ],
      },
      select: { organizationId: true },
    });
    return integrations.map((integration) => integration.organizationId);
  },

  async getMatchContext(organizationId) {
    const [employees, mappings] = await Promise.all([
      prisma.organizationMembership.findMany({
        where: { organizationId, role: "EMPLOYEE" },
        select: {
          id: true,
          isActive: true,
          employmentStatus: true,
          accountActivatedAt: true,
          user: { select: { email: true, name: true } },
        },
      }),
      prisma.employeeDirectoryMapping.findMany({
        where: { organizationId },
        select: {
          externalEmployeeId: true,
          employeeCode: true,
          fullName: true,
          email: true,
          department: true,
          designation: true,
          externalStatus: true,
          normalizedStatus: true,
          matchStatus: true,
          matchMethod: true,
          matchedMembershipId: true,
        },
      }),
    ]);
    return {
      employees: employees.map((employee) => ({
        membershipId: employee.id,
        email: employee.user.email,
        name: employee.user.name,
        status: employee.employmentStatus,
        isActive: employee.isActive,
        accountActivatedAt: employee.accountActivatedAt,
      })),
      mappings: mappings.map((mapping) => ({
        ...mapping,
        matchStatus: lower<
          "matched" | "unmatched" | "ambiguous" | "duplicate_external_id"
        >(mapping.matchStatus),
        matchMethod: mapping.matchMethod
          ? lower<"unique_email" | "explicit">(mapping.matchMethod)
          : null,
      })),
    };
  },

  async findProvisioningEmailConflicts(input) {
    if (input.emails.length === 0) return [];
    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [...new Set(input.emails.map((email) => email.toLowerCase()))],
        },
        memberships: {
          some: { organizationId: { not: input.organizationId } },
        },
      },
      select: { email: true },
    });
    return users.map((user) => user.email);
  },

  async completeSync(input) {
    const counts = countDecisions(input.decisions);
    return prisma.$transaction(async (transaction) => {
      const invitationDeliveries: InvitationDelivery[] = [];
      const run = await transaction.employeeDirectorySyncRun.findFirstOrThrow({
        where: {
          id: input.runId,
          organizationId: input.organizationId,
          status: "RUNNING",
        },
        select: {
          integrationId: true,
          requestedByMembershipId: true,
        },
      });
      const uniqueDecisions = new Map(
        input.decisions.map((decision) => [
          decision.externalEmployeeId,
          decision,
        ]),
      );
      for (const decision of uniqueDecisions.values()) {
        let matchedMembershipId = decision.matchedMembershipId;
        let lifecycleEvent:
          | "EMPLOYEE_DIRECTORY_EMPLOYEE_ADDED"
          | "EMPLOYEE_DIRECTORY_EMPLOYEE_UPDATED"
          | "EMPLOYEE_DIRECTORY_EMPLOYEE_REMOVED"
          | "EMPLOYEE_DIRECTORY_EMPLOYEE_REACTIVATED"
          | null = null;
        let before: Prisma.InputJsonObject | null = null;
        if (
          decision.provision &&
          decision.email &&
          decision.normalizedStatus === EmploymentStatus.ACTIVE
        ) {
          const existingUser = await transaction.user.findUnique({
            where: { email: decision.email.toLowerCase() },
            select: {
              id: true,
              memberships: {
                select: { id: true, organizationId: true, role: true },
              },
            },
          });
          const sameOrganizationMembership = existingUser?.memberships.find(
            (membership) =>
              membership.organizationId === input.organizationId &&
              membership.role === MembershipRole.EMPLOYEE,
          );
          if (sameOrganizationMembership) {
            matchedMembershipId = sameOrganizationMembership.id;
          } else if (!existingUser || existingUser.memberships.length === 0) {
            const user = existingUser
              ? await transaction.user.update({
                  where: { id: existingUser.id },
                  data: { name: decision.fullName },
                  select: { id: true },
                })
              : await transaction.user.create({
                  data: {
                    email: decision.email.toLowerCase(),
                    name: decision.fullName,
                    passwordHash: "erpnext-unclaimed-account",
                  },
                  select: { id: true },
                });
            const membership = await transaction.organizationMembership.create({
              data: {
                organizationId: input.organizationId,
                userId: user.id,
                role: MembershipRole.EMPLOYEE,
                employmentStatus: EmploymentStatus.ACTIVE,
                employmentStatusSource: "ERPNEXT",
                employmentStatusSyncedAt: input.completedAt,
                isActive: false,
                accountActivatedAt: null,
              },
              select: { id: true },
            });
            matchedMembershipId = membership.id;
            lifecycleEvent = "EMPLOYEE_DIRECTORY_EMPLOYEE_ADDED";
          }
        }
        const persistedMatchStatus = matchedMembershipId
          ? "MATCHED"
          : (decision.matchStatus.toUpperCase() as
              "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "DUPLICATE_EXTERNAL_ID");
        await transaction.employeeDirectoryMapping.upsert({
          where: {
            organizationId_integrationId_externalEmployeeId: {
              organizationId: input.organizationId,
              integrationId: run.integrationId,
              externalEmployeeId: decision.externalEmployeeId,
            },
          },
          create: {
            organizationId: input.organizationId,
            integrationId: run.integrationId,
            externalEmployeeId: decision.externalEmployeeId,
            employeeCode: decision.employeeCode ?? null,
            fullName: decision.fullName,
            email: decision.email ?? null,
            department: decision.department ?? null,
            designation: decision.designation ?? null,
            externalStatus: decision.externalStatus,
            normalizedStatus: decision.normalizedStatus ?? null,
            matchStatus: persistedMatchStatus,
            matchMethod: (decision.matchMethod?.toUpperCase() ?? null) as
              "UNIQUE_EMAIL" | "EXPLICIT" | null,
            matchedMembershipId: matchedMembershipId ?? null,
            lastSynchronizedAt: input.completedAt,
          },
          update: {
            employeeCode: decision.employeeCode ?? null,
            fullName: decision.fullName,
            email: decision.email ?? null,
            department: decision.department ?? null,
            designation: decision.designation ?? null,
            externalStatus: decision.externalStatus,
            normalizedStatus: decision.normalizedStatus ?? null,
            matchStatus: persistedMatchStatus,
            matchMethod: (decision.matchMethod?.toUpperCase() ?? null) as
              "UNIQUE_EMAIL" | "EXPLICIT" | null,
            matchedMembershipId: matchedMembershipId ?? null,
            lastSynchronizedAt: input.completedAt,
          },
        });
        if (matchedMembershipId && decision.normalizedStatus) {
          const membership = await transaction.organizationMembership.findFirst(
            {
              where: {
                id: matchedMembershipId,
                organizationId: input.organizationId,
                role: MembershipRole.EMPLOYEE,
              },
              select: {
                id: true,
                isActive: true,
                employmentStatus: true,
                removedAt: true,
                accountActivatedAt: true,
                user: { select: { id: true, name: true, email: true } },
              },
            },
          );
          if (!membership) continue;
          const employmentActive =
            decision.normalizedStatus === EmploymentStatus.ACTIVE;
          const active =
            employmentActive && membership.accountActivatedAt !== null;
          if (lifecycleEvent !== "EMPLOYEE_DIRECTORY_EMPLOYEE_ADDED") {
            before = {
              name: membership.user.name,
              email: membership.user.email,
              employmentStatus: membership.employmentStatus,
              isActive: membership.isActive,
            };
          }
          await transaction.organizationMembership.update({
            where: {
              id: matchedMembershipId,
            },
            data: {
              employmentStatus: decision.normalizedStatus,
              employmentStatusSource: "ERPNEXT",
              employmentStatusSyncedAt: input.completedAt,
              isActive: active,
              removedAt: employmentActive
                ? null
                : (membership.removedAt ?? input.completedAt),
            },
          });
          await transaction.user.update({
            where: { id: membership.user.id },
            data: {
              name: decision.fullName,
              ...(decision.email && membership.accountActivatedAt === null
                ? { email: decision.email.toLowerCase() }
                : {}),
            },
          });
          if (!active && membership.isActive) {
            lifecycleEvent = "EMPLOYEE_DIRECTORY_EMPLOYEE_REMOVED";
            await transaction.session.deleteMany({
              where: {
                organizationId: input.organizationId,
                userId: membership.user.id,
              },
            });
          } else if (active && !membership.isActive) {
            lifecycleEvent = "EMPLOYEE_DIRECTORY_EMPLOYEE_REACTIVATED";
          } else if (
            !lifecycleEvent &&
            (membership.user.name !== decision.fullName ||
              (decision.email &&
                membership.accountActivatedAt === null &&
                membership.user.email !== decision.email.toLowerCase()) ||
              membership.employmentStatus !== decision.normalizedStatus)
          ) {
            lifecycleEvent = "EMPLOYEE_DIRECTORY_EMPLOYEE_UPDATED";
          }
          if (decision.normalizedStatus !== EmploymentStatus.ACTIVE) {
            await transaction.employeeInvitation.updateMany({
              where: {
                organizationId: input.organizationId,
                employeeMembershipId: matchedMembershipId,
                status: "PENDING",
              },
              data: { status: "REVOKED", revokedAt: input.completedAt },
            });
          }
          if (
            decision.normalizedStatus === EmploymentStatus.ACTIVE &&
            membership.accountActivatedAt === null &&
            decision.email
          ) {
            const normalizedEmail = decision.email.toLowerCase();
            const pending = await transaction.employeeInvitation.findFirst({
              where: {
                organizationId: input.organizationId,
                employeeMembershipId: matchedMembershipId,
                status: "PENDING",
              },
              orderBy: { createdAt: "desc" },
            });
            if (pending && pending.email !== normalizedEmail) {
              await transaction.employeeInvitation.update({
                where: { id: pending.id },
                data: { status: "REVOKED", revokedAt: input.completedAt },
              });
            }
            const usablePending =
              pending &&
              pending.email === normalizedEmail &&
              pending.expiresAt > input.completedAt
                ? pending
                : null;
            if (
              pending &&
              pending.email === normalizedEmail &&
              pending.expiresAt <= input.completedAt
            ) {
              await transaction.employeeInvitation.update({
                where: { id: pending.id },
                data: { status: "EXPIRED" },
              });
            }
            if (!usablePending || usablePending.sentAt === null) {
              const secureToken = generateSecureToken();
              const expiresAt = new Date(
                input.completedAt.getTime() + 7 * 24 * 60 * 60_000,
              );
              const invitation = usablePending
                ? await transaction.employeeInvitation.update({
                    where: { id: usablePending.id },
                    data: {
                      tokenHash: secureToken.tokenHash,
                      expiresAt,
                      deliveryStatus: "CREATED",
                      deliveryFailureCode: null,
                    },
                  })
                : await transaction.employeeInvitation.create({
                    data: {
                      organizationId: input.organizationId,
                      employeeMembershipId: matchedMembershipId,
                      email: normalizedEmail,
                      tokenHash: secureToken.tokenHash,
                      expiresAt,
                      invitedByMembershipId: run.requestedByMembershipId,
                    },
                  });
              const organization =
                await transaction.organization.findUniqueOrThrow({
                  where: { id: input.organizationId },
                  select: { name: true },
                });
              invitationDeliveries.push({
                runId: input.runId,
                invitationId: invitation.id,
                organizationId: input.organizationId,
                organizationName: organization.name,
                email: normalizedEmail,
                token: secureToken.token,
                expiresAt,
              });
            }
          }
        }
        if (lifecycleEvent && matchedMembershipId) {
          await transaction.auditEvent.create({
            data: {
              organizationId: input.organizationId,
              actorMembershipId: run.requestedByMembershipId,
              targetMembershipId: matchedMembershipId,
              type: lifecycleEvent,
              title: {
                EMPLOYEE_DIRECTORY_EMPLOYEE_ADDED:
                  "Employee added from ERPNext",
                EMPLOYEE_DIRECTORY_EMPLOYEE_UPDATED:
                  "Employee updated from ERPNext",
                EMPLOYEE_DIRECTORY_EMPLOYEE_REMOVED:
                  "Employee marked as former",
                EMPLOYEE_DIRECTORY_EMPLOYEE_REACTIVATED:
                  "Employee reactivated from ERPNext",
              }[lifecycleEvent],
              metadata: {
                externalEmployeeId: decision.externalEmployeeId,
                before,
                after: {
                  name: decision.fullName,
                  email: decision.email ?? null,
                  employmentStatus: decision.normalizedStatus ?? null,
                  isActive:
                    decision.normalizedStatus === EmploymentStatus.ACTIVE,
                },
              },
              occurredAt: input.completedAt,
            },
          });
        }
      }
      await transaction.employeeDirectorySyncRun.update({
        where: { id: input.runId },
        data: {
          status: input.status.toUpperCase() as "SUCCESS" | "PARTIAL",
          processedCount: input.processedCount,
          createdCount: input.createdCount,
          updatedCount: input.updatedCount,
          unchangedCount: input.unchangedCount,
          reviewCount: input.reviewCount,
          retrievedCount: input.retrievedCount,
          ...counts,
          statusChangeCount: input.statusChangeCount,
          deactivatedCount: input.deactivatedCount,
          reactivatedCount: input.reactivatedCount,
          invitationCreatedCount: invitationDeliveries.length,
          errorCount: input.errorCount,
          safeErrorCode: input.safeErrorCode,
          safeErrorSummary: input.safeErrorSummary,
          completedAt: input.completedAt,
          durationMs: input.durationMs,
        },
      });
      await transaction.employeeDirectoryIntegration.update({
        where: { id: run.integrationId },
        data: {
          lastSyncStatus: input.status.toUpperCase() as "SUCCESS" | "PARTIAL",
          lastSyncErrorCode: input.safeErrorCode ?? null,
          connectionStatus: "CONNECTED",
          lastConnectionCode: "SYNC_CONNECTION_OK",
          scheduledSyncPausedAt: null,
          schedulePauseCode: null,
          ...(input.status === "success"
            ? { lastSuccessfulSyncAt: input.completedAt }
            : {}),
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorMembershipId: run.requestedByMembershipId,
          type: "EMPLOYEE_DIRECTORY_SYNC_COMPLETED",
          title: "ERPNext employee directory synchronization completed",
          metadata: {
            runId: input.runId,
            status: input.status,
            processedCount: input.processedCount,
            createdCount: input.createdCount,
            updatedCount: input.updatedCount,
            unchangedCount: input.unchangedCount,
            reviewCount: input.reviewCount,
            retrievedCount: input.retrievedCount,
            ...counts,
            statusChangeCount: input.statusChangeCount,
            deactivatedCount: input.deactivatedCount,
            reactivatedCount: input.reactivatedCount,
            invitationCreatedCount: invitationDeliveries.length,
            errorCount: input.errorCount,
            safeErrorCode: input.safeErrorCode ?? null,
          },
          occurredAt: input.completedAt,
        },
      });
      return invitationDeliveries;
    });
  },

  async markInvitationDelivery(input) {
    await prisma.$transaction(async (transaction) => {
      const invitation = await transaction.employeeInvitation.findFirst({
        where: {
          id: input.invitationId,
          organizationId: input.organizationId,
          status: "PENDING",
        },
        select: {
          id: true,
          employeeMembershipId: true,
          deliveryStatus: true,
        },
      });
      if (!invitation) return;
      await transaction.employeeInvitation.update({
        where: { id: invitation.id },
        data: input.sentAt
          ? {
              sentAt: input.sentAt,
              deliveryStatus: "SENT",
              deliveryFailureCode: null,
            }
          : {
              deliveryStatus: "FAILED",
              deliveryFailureCode: input.failureCode ?? "EMAIL_DELIVERY_FAILED",
            },
      });
      const becameSent = input.sentAt && invitation.deliveryStatus !== "SENT";
      const becameFailed =
        !input.sentAt && invitation.deliveryStatus !== "FAILED";
      if (becameSent || becameFailed) {
        const syncRun = await transaction.employeeDirectorySyncRun.findFirst({
          where: {
            id: input.runId,
            organizationId: input.organizationId,
          },
          select: { integrationId: true },
        });
        await transaction.employeeDirectorySyncRun.updateMany({
          where: {
            id: input.runId,
            organizationId: input.organizationId,
          },
          data: becameSent
            ? { invitationSentCount: { increment: 1 } }
            : {
                invitationFailureCount: { increment: 1 },
                status: "PARTIAL",
                safeErrorCode: input.failureCode ?? "EMAIL_DELIVERY_FAILED",
                safeErrorSummary:
                  "One or more employee invitation emails could not be delivered.",
              },
        });
        if (becameFailed && syncRun) {
          await transaction.employeeDirectoryIntegration.update({
            where: { id: syncRun.integrationId },
            data: {
              lastSyncStatus: "PARTIAL",
              lastSyncErrorCode: input.failureCode ?? "EMAIL_DELIVERY_FAILED",
            },
          });
        }
      }
      if (input.sentAt) {
        await transaction.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            targetMembershipId: invitation.employeeMembershipId,
            type: "EMPLOYEE_INVITATION_SENT",
            title: "Employee invitation sent",
            occurredAt: input.sentAt,
          },
        });
      }
    });
  },

  async failSync(input) {
    await prisma.$transaction(async (transaction) => {
      const run = await transaction.employeeDirectorySyncRun.findFirstOrThrow({
        where: { id: input.runId, organizationId: input.organizationId },
        select: { integrationId: true, requestedByMembershipId: true },
      });
      await transaction.employeeDirectorySyncRun.update({
        where: { id: input.runId },
        data: {
          status: "FAILED",
          safeErrorCode: input.safeErrorCode,
          safeErrorSummary: input.safeErrorSummary,
          errorCount: 1,
          completedAt: input.completedAt,
          durationMs: input.durationMs,
        },
      });
      const permanentFailure = isPermanentScheduledSyncError(
        input.safeErrorCode as EmployeeDirectoryErrorCode,
      );
      await transaction.employeeDirectoryIntegration.update({
        where: { id: run.integrationId },
        data: {
          lastSyncStatus: "FAILED",
          lastSyncErrorCode: input.safeErrorCode,
          connectionStatus: "FAILED",
          lastConnectionCode: input.safeErrorCode,
          ...(permanentFailure
            ? {
                scheduledSyncPausedAt: input.completedAt,
                schedulePauseCode: input.safeErrorCode,
              }
            : {}),
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorMembershipId: run.requestedByMembershipId,
          type: "EMPLOYEE_DIRECTORY_SYNC_FAILED",
          title: "ERPNext employee directory synchronization failed",
          metadata: { runId: input.runId, safeErrorCode: input.safeErrorCode },
          occurredAt: input.completedAt,
        },
      });
    });
  },

  async getDashboard(organizationId): Promise<EmployeeDirectoryDashboard> {
    const [organization, integration] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { erpNextEnabled: true },
      }),
      prisma.employeeDirectoryIntegration.findUnique({
        where: { organizationId },
        select: {
          ...integrationSelection,
          syncRuns: {
            orderBy: { startedAt: "desc" },
            take: 10,
            select: {
              id: true,
              trigger: true,
              status: true,
              processedCount: true,
              createdCount: true,
              updatedCount: true,
              unchangedCount: true,
              reviewCount: true,
              retrievedCount: true,
              matchedCount: true,
              unmatchedCount: true,
              ambiguousCount: true,
              statusChangeCount: true,
              deactivatedCount: true,
              reactivatedCount: true,
              invitationCreatedCount: true,
              invitationSentCount: true,
              invitationFailureCount: true,
              errorCount: true,
              safeErrorCode: true,
              safeErrorSummary: true,
              correlationId: true,
              startedAt: true,
              completedAt: true,
              durationMs: true,
            },
          },
          mappings: {
            where: {
              OR: [
                { matchStatus: { not: "MATCHED" } },
                { normalizedStatus: null },
              ],
            },
            orderBy: { lastSynchronizedAt: "desc" },
            take: 100,
            select: {
              externalEmployeeId: true,
              employeeCode: true,
              fullName: true,
              email: true,
              department: true,
              designation: true,
              externalStatus: true,
              normalizedStatus: true,
              matchStatus: true,
              lastSynchronizedAt: true,
            },
          },
        },
      }),
    ]);
    if (!integration) {
      return {
        configured: false,
        erpNextEnabled: organization?.erpNextEnabled ?? false,
        integration: null,
        latestRun: null,
        history: [],
        reviewRecords: [],
      };
    }
    const runs = integration.syncRuns.map((run) => ({
      ...run,
      trigger: lower<"manual" | "scheduled">(run.trigger),
      status: lower<"running" | "success" | "partial" | "failed">(run.status),
    }));
    return {
      configured: true,
      erpNextEnabled: organization?.erpNextEnabled ?? false,
      integration: {
        baseUrl: integration.baseUrl,
        apiPath: integration.apiPath,
        apiVersion: integration.apiVersion,
        authMethod: lower(integration.authMethod),
        credentialConfigured: Boolean(integration.credentialReference),
        timeoutMs: integration.timeoutMs,
        connectionStatus: lower(integration.connectionStatus),
        lastConnectionCode: integration.lastConnectionCode,
        lastTestedAt: integration.lastTestedAt,
        lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt,
        lastSyncStatus: integration.lastSyncStatus
          ? lower<"running" | "success" | "partial" | "failed">(
              integration.lastSyncStatus,
            )
          : null,
        lastSyncErrorCode: integration.lastSyncErrorCode,
        scheduledSyncPausedAt: integration.scheduledSyncPausedAt,
        schedulePauseCode: integration.schedulePauseCode,
        statusMapping: readStatusMapping(integration.statusMapping),
      },
      latestRun: runs[0] ?? null,
      history: runs.map(
        ({
          id,
          trigger,
          status,
          processedCount,
          createdCount,
          updatedCount,
          unchangedCount,
          reviewCount,
          retrievedCount,
          matchedCount,
          unmatchedCount,
          ambiguousCount,
          deactivatedCount,
          reactivatedCount,
          invitationCreatedCount,
          invitationSentCount,
          invitationFailureCount,
          errorCount,
          startedAt,
          durationMs,
        }) => ({
          id,
          trigger,
          status,
          processedCount,
          createdCount,
          updatedCount,
          unchangedCount,
          reviewCount,
          retrievedCount,
          matchedCount,
          unmatchedCount,
          ambiguousCount,
          deactivatedCount,
          reactivatedCount,
          invitationCreatedCount,
          invitationSentCount,
          invitationFailureCount,
          errorCount,
          startedAt,
          durationMs,
        }),
      ),
      reviewRecords: integration.mappings.map((mapping) => ({
        ...mapping,
        matchStatus: lower<
          "matched" | "unmatched" | "ambiguous" | "duplicate_external_id"
        >(mapping.matchStatus),
        statusMapped: mapping.normalizedStatus !== null,
        reviewCode:
          mapping.normalizedStatus === null
            ? "STATUS_NOT_MAPPED"
            : mapping.email === null
              ? "MISSING_EMAIL"
              : mapping.matchStatus === "DUPLICATE_EXTERNAL_ID"
                ? "DUPLICATE_EXTERNAL_ID"
                : mapping.matchStatus === "AMBIGUOUS"
                  ? "EMAIL_OR_ACCOUNT_CONFLICT"
                  : "NO_MATCH",
      })),
    };
  },
};
