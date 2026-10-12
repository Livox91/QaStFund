import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/infrastructure/database/prisma";

describe("database financial invariants", () => {
  it("installs authoritative money-bound checks", async () => {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conname IN (
        'LendingOffer_amount_positive_check',
        'LendingOffer_available_capacity_check',
        'LendingOffer_loan_bounds_check',
        'LendingOffer_terms_check',
        'Loan_financial_terms_check',
        'LoanRepayment_amount_positive_check',
        'LedgerEntry_amount_positive_check'
      )
    `;

    expect(new Set(rows.map((row) => row.name))).toEqual(
      new Set([
        "LendingOffer_amount_positive_check",
        "LendingOffer_available_capacity_check",
        "LendingOffer_loan_bounds_check",
        "LendingOffer_terms_check",
        "Loan_financial_terms_check",
        "LoanRepayment_amount_positive_check",
        "LedgerEntry_amount_positive_check",
      ]),
    );
  });

  it("keeps canonical chain identifiers and repayment submissions unique", async () => {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'LendingOffer_contractAddress_chainOfferId_key',
          'LoanRepayment_submissionTransactionHash_key'
        )
    `;

    expect(new Set(rows.map((row) => row.name))).toEqual(
      new Set([
        "LendingOffer_contractAddress_chainOfferId_key",
        "LoanRepayment_submissionTransactionHash_key",
      ]),
    );
  });
});
