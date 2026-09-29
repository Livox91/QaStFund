ALTER TABLE "Loan"
ADD COLUMN "chainLoanId" VARCHAR(78),
ADD COLUMN "chainOfferId" VARCHAR(78),
ADD COLUMN "contractAddress" VARCHAR(42),
ADD COLUMN "lenderWalletAddress" VARCHAR(42),
ADD COLUMN "borrowerWalletAddress" VARCHAR(42),
ADD COLUMN "principalBaseUnits" BIGINT,
ADD COLUMN "repaymentBaseUnits" BIGINT,
ADD COLUMN "acceptanceTransactionHash" VARCHAR(66),
ADD COLUMN "onChainStartedAt" TIMESTAMP(3),
ADD COLUMN "onChainDueAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Loan_acceptanceTransactionHash_key"
ON "Loan"("acceptanceTransactionHash");

CREATE INDEX "Loan_organizationId_chainOfferId_idx"
ON "Loan"("organizationId", "chainOfferId");
