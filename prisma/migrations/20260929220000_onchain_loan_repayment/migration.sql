ALTER TABLE "Loan"
ADD COLUMN "repaymentTransactionHash" VARCHAR(66),
ADD COLUMN "onChainRepaidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Loan_repaymentTransactionHash_key"
ON "Loan"("repaymentTransactionHash");
