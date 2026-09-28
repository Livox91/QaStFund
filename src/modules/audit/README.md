# Audit

Owns the append-only activity trail. Loan confirmation creates a `LOAN_CREATED`
event inside the same database transaction as the loan, balance, offer, and
ledger changes.

Owns append-only audit records. The initial `AuditEvent` read model provides
the employer loan timeline. Administrative writers and broader audit-log views
are deferred.
