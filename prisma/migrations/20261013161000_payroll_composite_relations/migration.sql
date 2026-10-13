CREATE UNIQUE INDEX "PayrollDeductionProposal_organizationId_repaymentId_key" ON "PayrollDeductionProposal"("organizationId", "repaymentId");
CREATE UNIQUE INDEX "DelinquencyCase_organizationId_installmentId_key" ON "DelinquencyCase"("organizationId", "installmentId");
