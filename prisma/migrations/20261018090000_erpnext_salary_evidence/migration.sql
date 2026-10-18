CREATE TABLE "SalaryEvidence" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "employeeMappingId" UUID NOT NULL,
    "externalSalarySlipId" VARCHAR(140) NOT NULL,
    "payrollPeriodStart" TIMESTAMP(3) NOT NULL,
    "payrollPeriodEnd" TIMESTAMP(3) NOT NULL,
    "grossPayMinorUnits" BIGINT NOT NULL,
    "netPayMinorUnits" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "documentStatus" INTEGER NOT NULL,
    "sourceModifiedAt" TIMESTAMP(3) NOT NULL,
    "synchronizedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncErrorCode" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalaryEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalaryEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalaryEvidence_organizationId_employeeMappingId_fkey" FOREIGN KEY ("organizationId", "employeeMappingId") REFERENCES "EmployeeDirectoryMapping"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalaryEvidence_documentStatus_check" CHECK ("documentStatus" IN (0, 1, 2)),
    CONSTRAINT "SalaryEvidence_amounts_check" CHECK ("grossPayMinorUnits" >= 0 AND "netPayMinorUnits" >= 0),
    CONSTRAINT "SalaryEvidence_period_check" CHECK ("payrollPeriodEnd" >= "payrollPeriodStart")
);

CREATE UNIQUE INDEX "SalaryEvidence_organizationId_externalSalarySlipId_key" ON "SalaryEvidence"("organizationId", "externalSalarySlipId");
CREATE UNIQUE INDEX "SalaryEvidence_employeeMappingId_payrollPeriodStart_payrollPeriodEnd_key" ON "SalaryEvidence"("employeeMappingId", "payrollPeriodStart", "payrollPeriodEnd");
CREATE INDEX "SalaryEvidence_organizationId_employeeMappingId_payrollPeriodEnd_idx" ON "SalaryEvidence"("organizationId", "employeeMappingId", "payrollPeriodEnd");
