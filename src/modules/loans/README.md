# Loans

Owns the future loan lifecycle. The current read model supports the employer
overview and read-only loan list/details, including agreed terms, completed
repayments, remaining amount, statuses, and audit timeline data.

Employer queries are scoped using the organization from the authenticated
actor. Financial calculations use integer minor units. Loan creation, state
transitions, repayment commands, penalties, and ledger behavior are not
implemented.
