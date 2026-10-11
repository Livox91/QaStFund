import "dotenv/config";

import { createHash } from "node:crypto";

import { validateEnvironment } from "@/infrastructure/config/environment";
import { prisma } from "@/infrastructure/database/prisma";

const environment = validateEnvironment();
const now = new Date();
const integrations = await prisma.employeeDirectoryIntegration.findMany({
  orderBy: { createdAt: "asc" },
  select: {
    connectionStatus: true,
    lastConnectionCode: true,
    lastTestedAt: true,
    lastSuccessfulSyncAt: true,
    lastSyncStatus: true,
    lastSyncErrorCode: true,
    scheduledSyncPausedAt: true,
    schedulePauseCode: true,
    organization: { select: { erpNextEnabled: true } },
    _count: { select: { mappings: true } },
    syncRuns: {
      orderBy: { startedAt: "desc" },
      take: 5,
      select: {
        trigger: true,
        status: true,
        processedCount: true,
        retrievedCount: true,
        matchedCount: true,
        unmatchedCount: true,
        ambiguousCount: true,
        reviewCount: true,
        errorCount: true,
        invitationCreatedCount: true,
        invitationSentCount: true,
        invitationFailureCount: true,
        safeErrorCode: true,
        safeErrorSummary: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
      },
    },
  },
});

const mappingStatus = await prisma.employeeDirectoryMapping.groupBy({
  by: ["matchStatus", "normalizedStatus"],
  _count: { _all: true },
});
const membershipStatus = await prisma.organizationMembership.groupBy({
  by: ["employmentStatus", "employmentStatusSource", "isActive"],
  _count: { _all: true },
});
const reviewMappings = await prisma.employeeDirectoryMapping.findMany({
  where: {
    OR: [{ matchStatus: { not: "MATCHED" } }, { normalizedStatus: null }],
  },
  select: {
    organizationId: true,
    externalEmployeeId: true,
    employeeCode: true,
    email: true,
    externalStatus: true,
    normalizedStatus: true,
    matchStatus: true,
    matchedMembershipId: true,
  },
});
const reviewDiagnostics = await Promise.all(
  reviewMappings.map(async (mapping) => {
    const normalizedEmail = mapping.email?.trim().toLowerCase() ?? null;
    const [organizationMatches, globalMatches] = normalizedEmail
      ? await Promise.all([
          prisma.organizationMembership.count({
            where: {
              organizationId: mapping.organizationId,
              user: { email: normalizedEmail },
            },
          }),
          prisma.organizationMembership.count({
            where: { user: { email: normalizedEmail } },
          }),
        ])
      : [0, 0];
    const reviewCode =
      mapping.normalizedStatus === null
        ? "STATUS_NOT_MAPPED"
        : mapping.email === null
          ? "MISSING_EMAIL"
          : mapping.matchStatus === "DUPLICATE_EXTERNAL_ID"
            ? "DUPLICATE_EXTERNAL_ID"
            : mapping.matchStatus === "AMBIGUOUS"
              ? "EMAIL_OR_ACCOUNT_CONFLICT"
              : "NO_MATCH";
    return {
      sourceIdentifierFingerprint: createHash("sha256")
        .update(mapping.externalEmployeeId)
        .digest("hex")
        .slice(0, 12),
      employeeCodePresent: Boolean(mapping.employeeCode),
      emailPresent: Boolean(mapping.email),
      externalStatus: mapping.externalStatus,
      normalizedStatus: mapping.normalizedStatus,
      matchStatus: mapping.matchStatus,
      mappedMembership: Boolean(mapping.matchedMembershipId),
      organizationEmailMatches: organizationMatches,
      globalEmailMatches: globalMatches,
      reviewCode,
    };
  }),
);
const invitationDelivery = await prisma.employeeInvitation.groupBy({
  by: ["status", "deliveryStatus", "deliveryFailureCode"],
  _count: { _all: true },
});
const invitationLifecycle = await prisma.employeeInvitation.findMany({
  orderBy: { createdAt: "asc" },
  select: {
    status: true,
    deliveryStatus: true,
    deliveryFailureCode: true,
    createdAt: true,
    sentAt: true,
    acceptedAt: true,
    revokedAt: true,
    expiresAt: true,
  },
});
const unresolvedInvitationFailures = invitationDelivery.reduce(
  (count, group) =>
    count + (group.deliveryStatus === "FAILED" ? group._count._all : 0),
  0,
);
const reviewRecordCount = mappingStatus.reduce(
  (count, group) =>
    count + (group.matchStatus === "MATCHED" ? 0 : group._count._all),
  0,
);
const issues: string[] = [];
const enabledIntegrations = integrations.filter(
  (integration) => integration.organization.erpNextEnabled,
);
if (enabledIntegrations.length > 0 && !environment.ERP_NEXT_SYNC_ENABLED) {
  issues.push("ERP_NEXT_SCHEDULING_DISABLED");
}
for (const [index, integration] of enabledIntegrations.entries()) {
  if (integration.lastSyncStatus !== "SUCCESS") {
    issues.push(
      `INTEGRATION_${index + 1}_LATEST_SYNC_${integration.lastSyncStatus ?? "MISSING"}`,
    );
  }
  if (
    !integration.lastSuccessfulSyncAt ||
    now.getTime() - integration.lastSuccessfulSyncAt.getTime() >
      environment.ERP_NEXT_ELIGIBILITY_MAX_AGE_MINUTES * 60_000
  ) {
    issues.push(`INTEGRATION_${index + 1}_COMPLETE_SYNC_STALE`);
  }
}
if (unresolvedInvitationFailures > 0) {
  issues.push(`INVITATION_DELIVERY_FAILURES_${unresolvedInvitationFailures}`);
}
if (reviewRecordCount > 0) {
  issues.push(`DIRECTORY_REVIEW_RECORDS_${reviewRecordCount}`);
}

console.log(
  JSON.stringify(
    {
      ok: issues.length === 0,
      readOnly: true,
      runtime: {
        syncEnabled: process.env.ERP_NEXT_SYNC_ENABLED ?? null,
        intervalMinutes: process.env.ERP_NEXT_SYNC_INTERVAL_MINUTES ?? null,
        staleAfterMinutes:
          process.env.ERP_NEXT_SYNC_STALE_AFTER_MINUTES ?? null,
        cronSecretConfigured: Boolean(process.env.ERP_NEXT_SYNC_CRON_SECRET),
        encryptionKeyConfigured: Boolean(
          process.env.ERP_NEXT_CREDENTIAL_ENCRYPTION_KEY,
        ),
        emailProvider: process.env.EMAIL_PROVIDER ?? "http",
        emailCredentialsConfigured:
          process.env.EMAIL_PROVIDER === "smtp"
            ? Boolean(
                process.env.EMAIL_SMTP_HOST &&
                process.env.EMAIL_SMTP_USER &&
                process.env.EMAIL_SMTP_PASSWORD &&
                process.env.EMAIL_FROM,
              )
            : Boolean(
                process.env.EMAIL_DELIVERY_ENDPOINT &&
                process.env.EMAIL_DELIVERY_TOKEN &&
                process.env.EMAIL_FROM,
              ),
      },
      integrations: integrations.map((integration, index) => ({
        integration: index + 1,
        ...integration,
      })),
      mappingStatus,
      membershipStatus,
      reviewDiagnostics,
      invitationDelivery,
      invitationLifecycle: invitationLifecycle.map((invitation, index) => ({
        invitation: index + 1,
        ...invitation,
      })),
      issues,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
if (issues.length > 0) process.exitCode = 1;
