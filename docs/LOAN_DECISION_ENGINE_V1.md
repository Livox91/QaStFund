# Explainable loan decision engine v1

## Scope and safety boundary

`loan-decision-rules-v1` is a deterministic policy aid for new Arc borrowing
requests. It does not predict default probability, claim statistical accuracy,
or submit a blockchain transaction. The existing loan-decision module that
classifies active loans as current, due soon, overdue, or default candidates is
separate monitoring functionality and remains unchanged.

The origination engine executes before the server returns an Arc borrow
authorization. Every outcome, including `APPROVAL_CONSIDERATION`, requires an
immutable permitted employer-admin approval before wallet execution. The
authorization expires after five minutes. No contract change is included in
v1.

## Audited data sources

| Attribute                                 | Source                                                                                           | State in v1                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Employee identity/status                  | `OrganizationMembership` plus matched `EmployeeDirectoryMapping` and complete/fresh ERPNext sync | Available; nullable/stale states fail the independent trust gate  |
| Employment tenure                         | No field in the current ERPNext Employee adapter or application schema                           | Unavailable; produces `REVIEW_REQUIRED`                           |
| Verified net income                       | Payroll adapter is explicitly unimplemented                                                      | Unavailable; produces `REVIEW_REQUIRED`; never treated as zero    |
| Principal, fee, term, repayment structure | Requested `Loan` and funded `LendingOffer`                                                       | Available; Arc v1 is `BULLET`                                     |
| Existing obligations                      | Active/overdue/defaulted loans minus completed repayments                                        | Available; full remaining bullet obligations are used             |
| Outstanding principal                     | `Loan.outstandingPrincipalMinorUnits`                                                            | Available                                                         |
| Employer limit                            | Versioned `OrganizationLendingPolicy.maxLoanAmountMinorUnits` and `maxOutstandingDebtMinorUnits` | Available                                                         |
| Product limit                             | `LendingOffer.maximumLoanAmountMinorUnits`                                                       | Available                                                         |
| Repayment/default history                 | Prior loan status, due/closed timestamps, and completed repayment records                        | Available; a borrower with no history is explicitly new-to-credit |

ERPNext is not a payroll source. Names, email addresses, department, and
designation are not used as scoring proxies. No protected characteristic is
collected or scored.

## Versioned rules

The immutable configuration totals 100 points:

- repayment history: 35;
- affordability: 30;
- employment stability: 20; and
- existing exposure: 15.

Score bands are 75–100 `APPROVAL_CONSIDERATION`, 55–74 `REVIEW_REQUIRED`, and
0–54 `NOT_ELIGIBLE`, but they apply only when all required feature evidence is
complete, verified, fresh, and internally consistent. These are provisional
policy assumptions, not empirically validated predictions or probabilities of
default.

Repayment history awards 35 for prior on-time completion, 25 for new-to-credit,
15 when prior late repayment exists, and 0 when a default exists. Employment
stability awards 20 at 24 months, 15 at 12 months, 10 at 6 months, and 5 below
6 months. Exposure awards 15, 10, 5, or 0 across projected exposure bands of
up to 25%, 50%, 75%, or above 75% of the configured maximum.

Affordability awards 30 up to a 20% burden, 24 up to 30%, 12 up to 40%, and 0
above 40%. The 40% cap is stored in versioned configuration. Installments use
the repayment divided by the installment count, rounded up. A bullet loan uses
the entire principal-plus-fee balloon as its proposed monthly obligation; it is
not treated as an installment loan.

`NOT_ELIGIBLE` is produced by a verified hard-gate failure (inactive
employment, invalid terms, failed affordability, employer/product loan limits,
or enforced exposure limit) or a complete-evidence score below 55. Incomplete
terms; invalid, unavailable, unverified, or stale income; unavailable tenure;
stale evidence; conflicting financial records; unverified identity/status; and
new-to-credit all route to `REVIEW_REQUIRED`. Missing features receive no
substitute value and their weights are never redistributed. Prior late
repayment and prior default reduce the repayment-history feature and the final
complete-evidence score band determines the outcome.

New-to-credit receives a neutral descriptive repayment-history value rather
than the default score, but still requires review. A missing repayment row is
never classified as a default. Late history is a loan-level bullet inference:
an `OVERDUE` loan or a repaid loan closed after its due date. A default is
counted only from authoritative `DEFAULTED` status.

The evaluator records whether required source data is fresh and whether the
underlying financial records are internally consistent. Mixed currencies,
invalid principal/fee/outstanding amounts, non-positive completed repayments,
overpayment, or a repaid loan retaining outstanding principal create a
non-overridable reconciliation review. Approval overrides also cannot bypass
mandatory identity, application, affordability, freshness, consistency, or
limit failures.

## Persistence and concurrency

`LoanOriginationDecision` stores the application (`loanId`), employee and
employer references, model version, status, nullable score, reason codes,
decision timestamp, explicit immutable `idempotencyKey`, immutable input
snapshot, and affordability snapshot. The input snapshot includes employee and
income verification timestamps and freshness state. The affordability snapshot
includes the pass result, burden, and maximum permitted principal when it can be
calculated. `(loanId, modelVersion)` and `idempotencyKey` are unique, making
repeated evaluation idempotent. `LoanOriginationOverride` stores one immutable
authorized outcome, reviewer, rationale, and timestamp. Decision creation and
override both create audit events.

Maximum permitted principal uses the configured maximum monthly burden less
existing monthly obligations. For an installment request, that available
monthly amount is multiplied by the verified installment count; for a bullet
request, it is used once. The requested fee is then deducted, floored at zero.
The value remains null if the income or application evidence cannot support the
calculation.

A partial unique database index permits only one `REQUESTED` application per
organization/borrower. Existing policy/exposure checks still execute inside the
borrow path, and the decision is evaluated before an authorization signature is
returned. Duplicate processing cannot create another decision or override.

## API and authorization

- `GET /api/loans/{loanId}/origination-decision` is employee-only and returns
  only the decision identity, version, status, timestamp, and override outcome.
- `GET /api/employer/loan-decisions?status=REVIEW_REQUIRED` is
  employer-admin-only and returns a tenant-scoped, bounded review queue without
  the full feature snapshots.
- `GET /api/employer/loan-decisions/{decisionId}` is employer-admin-only and
  returns the auditable snapshot.
- `POST /api/employer/loan-decisions/{decisionId}` is employer-admin-only,
  origin-checked, rate-limited, and accepts `APPROVED` or `REJECTED` with a
  20–1000 character rationale. Supported decision outcomes are
  `APPROVAL_CONSIDERATION`, `REVIEW_REQUIRED`, and `NOT_ELIGIBLE`.

The employer loan view exposes pending requests through its **Reviews** filter.
The detail page shows the decision version, score, reason codes, and immutable
review history. Approval transitions the unexecuted application from
`REQUESTED` to `APPROVED` and allows the employee to retry the same request; no
wallet action is initiated by the administrator. Rejection transitions it to
`CANCELLED`. Neither action changes an active loan or financial ledger record.

Employees cannot edit scores or override decisions. Tenant filters are applied
to every lookup. Sensitive feature snapshots are not returned by the employee
endpoint.

## Known limitations and next step

The production collector intentionally supplies `null` for verified income and
employment tenure because neither source exists. Consequently, every real v1
application requires review even if its available-data profile would otherwise
be strong. Automatic score-based approval remains disabled by this missing-data
behavior.

Before automatic approval can even be evaluated, the project needs an approved
payroll/net-income source with amount, period, currency, provenance,
verification and validity timestamps; an official employment-start field with
equivalent provenance/freshness; complete scheduled ERPNext synchronization;
currency rules; representative outcome data; backtesting and fairness review;
approved score/affordability thresholds; and an explicit controlled activation
decision. ERPNext `modified` is never employment tenure.

Arc authorization is the last server-controlled point before the wallet calls
the escrow contract. Revalidation after on-chain execution can only confirm and
reconcile the completed transaction; preventing execution after a decision
changes would require a new contract authorization design and is outside this
no-contract-change milestone.
