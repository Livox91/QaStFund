import "server-only";

import { prisma } from "@/infrastructure/database/prisma";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { PayrollCredential } from "@/modules/payroll-integration/domain/payroll";
import { PayrollIntegrationError } from "@/modules/payroll-integration/domain/payroll";
import { ErpNextPayrollAdapter } from "@/modules/payroll-integration/infrastructure/erpnext-payroll-adapter";

function credentialFor(organizationId: string): PayrollCredential {
  try {
    const raw = process.env.ERP_NEXT_PAYROLL_CREDENTIALS_JSON;
    const all: unknown = raw ? JSON.parse(raw) : null;
    if (!all || typeof all !== "object" || Array.isArray(all))
      throw new Error();
    const value = (all as Record<string, unknown>)[organizationId];
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    if (
      "apiKey" in value &&
      typeof value.apiKey === "string" &&
      "apiSecret" in value &&
      typeof value.apiSecret === "string"
    )
      return {
        method: "token",
        apiKey: value.apiKey,
        apiSecret: value.apiSecret,
      };
    if ("accessToken" in value && typeof value.accessToken === "string")
      return { method: "oauth_bearer", accessToken: value.accessToken };
  } catch {
    // All malformed and absent secret cases intentionally share one safe code.
  }
  throw new PayrollIntegrationError("PAYROLL_NOT_CONFIGURED", 503);
}

async function context(actor: AuthenticatedActor, mappingId: string) {
  requireEmployerAdmin(actor);
  const mapping = await prisma.employeeDirectoryMapping.findFirst({
    where: {
      id: mappingId,
      organizationId: actor.organizationId,
      matchStatus: "MATCHED",
      normalizedStatus: "ACTIVE",
    },
    include: { integration: true },
  });
  if (!mapping)
    throw new PayrollIntegrationError("PAYROLL_EMPLOYEE_NOT_FOUND", 404);
  const integration = mapping.integration;
  return {
    mapping,
    adapter: new ErpNextPayrollAdapter(
      {
        organizationId: actor.organizationId,
        baseUrl: integration.baseUrl,
        apiPath: integration.apiPath,
        apiVersion: integration.apiVersion,
        authMethod:
          integration.authMethod === "TOKEN" ? "token" : "oauth_bearer",
        credentialReference: "payroll-environment",
        timeoutMs: integration.timeoutMs,
      },
      credentialFor(actor.organizationId),
      {
        allowLocalDevelopment: process.env.ERP_NEXT_ALLOW_LOCAL_HTTP === "true",
      },
    ),
  };
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function listPayrollEmployeesForActor(actor: AuthenticatedActor) {
  requireEmployerAdmin(actor);
  return prisma.employeeDirectoryMapping.findMany({
    where: {
      organizationId: actor.organizationId,
      matchStatus: "MATCHED",
      normalizedStatus: "ACTIVE",
      matchedMembershipId: { not: null },
    },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, employeeCode: true },
  });
}

async function persistSalarySlip(
  organizationId: string,
  mappingId: string,
  slip: Awaited<ReturnType<ErpNextPayrollAdapter["createDraftSalarySlip"]>>,
) {
  const payrollPeriodStart = new Date(`${slip.periodStart}T00:00:00.000Z`);
  const payrollPeriodEnd = new Date(`${slip.periodEnd}T00:00:00.000Z`);
  return prisma.salaryEvidence.upsert({
    where: {
      employeeMappingId_payrollPeriodStart_payrollPeriodEnd: {
        employeeMappingId: mappingId,
        payrollPeriodStart,
        payrollPeriodEnd,
      },
    },
    create: {
      organizationId,
      employeeMappingId: mappingId,
      externalSalarySlipId: slip.externalId,
      payrollPeriodStart,
      payrollPeriodEnd,
      grossPayMinorUnits: slip.grossPayMinorUnits,
      netPayMinorUnits: slip.netPayMinorUnits,
      currency: slip.currency,
      documentStatus: slip.documentStatus,
      sourceModifiedAt: new Date(slip.modifiedAt),
      synchronizedAt: new Date(),
    },
    update: {
      externalSalarySlipId: slip.externalId,
      grossPayMinorUnits: slip.grossPayMinorUnits,
      netPayMinorUnits: slip.netPayMinorUnits,
      currency: slip.currency,
      documentStatus: slip.documentStatus,
      sourceModifiedAt: new Date(slip.modifiedAt),
      synchronizedAt: new Date(),
      lastSyncErrorCode: null,
    },
  });
}

export async function listSalarySlipsForActor(
  actor: AuthenticatedActor,
  mappingId: string,
  periodStart: Date,
  periodEnd: Date,
) {
  const { adapter, mapping } = await context(actor, mappingId);
  const slips = await adapter.listSalarySlips(
    mapping.externalEmployeeId,
    isoDate(periodStart),
    isoDate(periodEnd),
  );
  await Promise.all(
    slips.map((slip) =>
      persistSalarySlip(actor.organizationId, mapping.id, slip),
    ),
  );
  return slips;
}

export async function createDraftSalarySlipForActor(
  actor: AuthenticatedActor,
  mappingId: string,
  periodStart: Date,
  periodEnd: Date,
) {
  const { adapter, mapping } = await context(actor, mappingId);
  const slip = await adapter.createDraftSalarySlip(
    mapping.externalEmployeeId,
    isoDate(periodStart),
    isoDate(periodEnd),
  );
  return persistSalarySlip(actor.organizationId, mapping.id, slip);
}
