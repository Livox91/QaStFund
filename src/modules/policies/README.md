# Organization lending policies

Each organization has one versioned lending policy. Defaults and pure validation
live in `domain/lending-policy.ts`; API handlers do not implement policy rules.

Borrowing capacity counts unresolved `ACTIVE`, `OVERDUE`, and `DEFAULTED` loans.
It derives each remaining obligation from agreed principal plus fee minus completed
repayments. `REPAID` and `CANCELLED` loans do not consume capacity. Defaulted debt
continues to count until a future recovery policy explicitly changes that rule.

Offer creation locks and validates the organization policy and lender access.
Borrowing locks the borrower membership, lender access, and policy, then recomputes
obligations inside the same transaction that reserves offer capital, creates the
loan and policy snapshot, posts the ledger transfer, and writes the audit event.
Repayment intentionally does not consult eligibility or kill switches, so existing
obligations can always be repaid.
