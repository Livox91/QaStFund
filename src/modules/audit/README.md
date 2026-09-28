# Audit

Owns the append-only activity trail. Loan confirmation creates a `LOAN_CREATED`
event inside the same database transaction as the loan, balance, offer, and
ledger changes.

Manual repayments append `REPAYMENT_RECORDED`; a final repayment also appends
`LOAN_REPAID`. These events share the repayment database transaction.

The `AuditEvent` read model provides employer and employee loan timelines.
Administrative writers and broader audit-log views are deferred.
