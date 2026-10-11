# Loan decision engine v1 data-readiness audit

## Scope and conclusion

This is a read-only assessment of the repository and local database observed on
2026-10-11. It does not treat the local database as production evidence and
does not validate model accuracy. The worktree already contains uncommitted
origination-decision code and migrations; this audit describes the underlying
data independently and does not add or change scoring behavior.

**Recommendation: BLOCKED for automatic score-based approval.** The current
ERPNext connector has no employment start date, salary, payroll, payslip, or
verified net-income field. Therefore employment-tenure and affordability
features cannot be calculated from trusted evidence. **GO only for a guarded,
deterministic v1 that treats missing required evidence as
`REVIEW_REQUIRED`, keeps policy/identity/freshness checks as independent hard
gates, and never redistributes missing-feature weight.**

## Attribute-to-source matrix

| Proposed attribute             | Actual source                                                                                                                            | Exists  | Verified / nullable                                                                     | Fresh enough?                                                                                                                                                               | Calculation or restriction                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee identity              | `EmployeeDirectoryMapping.externalEmployeeId`, `employeeCode`, `matchedMembershipId`, `matchStatus`; `OrganizationMembership`            | Yes     | A mapping may be unmatched; matched membership is nullable                              | Trust requires a complete successful sync and a synchronized membership                                                                                                     | Require exactly one tenant-scoped `MATCHED` mapping when ERPNext is enabled. Do not match by inferred name.                                                       |
| Employment status              | `OrganizationMembership.employmentStatus`, `employmentStatusSource`, `employmentStatusSyncedAt`; ERPNext `Employee.status`               | Yes     | Status is non-null; source and sync timestamp are nullable                              | Yes only when the integration's latest state is `SUCCESS`, `lastSuccessfulSyncAt` is inside the configured window, and the membership timestamp is not older than that sync | Use as an eligibility gate, not a scored proxy. Suspended/terminated/inactive employees cannot originate new borrowing.                                           |
| Employment start date / tenure | No adapter or persisted field                                                                                                            | **No**  | Not available or verified                                                               | No                                                                                                                                                                          | Tenure cannot be calculated. ERPNext `modified` is record modification time, not joining date. Return review rather than inventing tenure.                        |
| Verified net income            | No employee-directory, payroll, or income-evidence model                                                                                 | **No**  | Not available or verified                                                               | No                                                                                                                                                                          | Debt-service or payment-to-income burden cannot be calculated. ERPNext email, department, designation, or status must not be used as income proxies.              |
| Salary / payslip history       | Not requested by `ErpNextEmployeeDirectoryAdapter`; payroll integration is absent                                                        | **No**  | Not available                                                                           | No                                                                                                                                                                          | No salary-derived feature is supportable in v1.                                                                                                                   |
| Requested principal            | `Loan.principalAmountMinorUnits`; source offer `LendingOffer.amountMinorUnits`                                                           | Yes     | Non-null integer minor units                                                            | Current at request creation; on-chain base units and receipt must still reconcile                                                                                           | Use integer arithmetic. The current Arc acceptance path requests the funded offer's full amount.                                                                  |
| Fee / agreed return            | `Loan.feeAmountMinorUnits`, `Loan.feeRateBasisPoints`, `repaymentBaseUnits`                                                              | Yes     | Fee/rate non-null; chain amount nullable before on-chain setup                          | Fresh at request creation and later reconcilable                                                                                                                            | Total agreed repayment is principal plus fee. On Arc, derive from exact base units and round minor units explicitly.                                              |
| Term and due date              | `Loan.durationDays`, `repaymentDueAt`; offer `durationDays`                                                                              | Yes     | Non-null                                                                                | Current at request creation; confirmed on-chain dates are separately stored                                                                                                 | Validate against policy minimum/maximum term.                                                                                                                     |
| Repayment structure / schedule | One loan-level `repaymentDueAt`; no installment schedule table                                                                           | Partial | Non-null bullet due date; no installment rows                                           | Sufficient only for current bullet loans                                                                                                                                    | Treat current Arc loans as bullet obligations. Installment affordability is unsupported until a schedule exists.                                                  |
| Product loan limit             | `LendingOffer.minimumLoanAmountMinorUnits`, `maximumLoanAmountMinorUnits`, available amount and offer status                             | Yes     | Non-null                                                                                | Must be checked against the current funded, active, unexpired offer and on-chain offer state                                                                                | Reject requests outside the product/offer limit.                                                                                                                  |
| Employer policy limits         | `OrganizationLendingPolicy.maxLoanAmountMinorUnits`, `maxOutstandingDebtMinorUnits`, `maxActiveLoans`, term/rate bounds, `policyVersion` | Yes     | Non-null; a default policy may be created                                               | Current policy is loaded during borrowing; the accepted version is snapshotted on `Loan`                                                                                    | Keep as mandatory gates independent of any score.                                                                                                                 |
| Outstanding principal          | `Loan.outstandingPrincipalMinorUnits`                                                                                                    | Yes     | Non-null                                                                                | Depends on confirmation/reconciliation health                                                                                                                               | Sum tenant-scoped borrower loans in active/overdue/defaulted states. Do not mix currencies.                                                                       |
| Existing total obligation      | Loan principal plus fee minus `COMPLETED` repayments                                                                                     | Yes     | Repayment amounts/status are non-null                                                   | Depends on reconciliation health                                                                                                                                            | The existing policy implementation uses remaining agreed obligation, including fees. This is not identical to outstanding principal and must be named separately. |
| Active-loan exposure           | Borrower loans with status `ACTIVE`, `OVERDUE`, or `DEFAULTED`; policy maximum                                                           | Yes     | Non-null statuses                                                                       | Depends on current database/reconciliation state                                                                                                                            | Count active obligations and sum the chosen principal or total-obligation definition consistently. Include the proposed principal when testing the limit.         |
| Completed repayments           | `LoanRepayment.amountMinorUnits`, `status`, `paidAt`, `completedAt`                                                                      | Yes     | `completedAt` is nullable; `paidAt` is non-null                                         | Final only when status is `COMPLETED` and chain reconciliation is healthy                                                                                                   | Sum only completed repayments. Request IDs provide idempotency.                                                                                                   |
| On-time completed loans        | `Loan.status = REPAID`, `closedAt`, `repaymentDueAt`                                                                                     | Yes     | `closedAt` is nullable in schema but required by lifecycle constraints for closed loans | Historical                                                                                                                                                                  | Infer on-time completion only when `closedAt <= repaymentDueAt`.                                                                                                  |
| Late repayment                 | `OVERDUE` status or a repaid loan with `closedAt > repaymentDueAt`                                                                       | Partial | No installment-level lateness or explicit days-late field                               | Historical loan-level inference only                                                                                                                                        | Suitable for bullet-loan history; unsuitable for installment delinquency.                                                                                         |
| Defaults                       | `Loan.status = DEFAULTED` and audit history                                                                                              | Yes     | Status is explicit; default reason/time is not a dedicated loan field                   | Historical                                                                                                                                                                  | Count explicit defaulted loans. Use audit events if a default timestamp is required.                                                                              |
| New-to-credit                  | Absence of prior repaid/late/defaulted borrower loans                                                                                    | Yes     | Derived                                                                                 | Current at evaluation time                                                                                                                                                  | Record explicitly; do not treat missing history as proven good history.                                                                                           |

All money is stored as integer minor units (`BigInt`) or token base units.
Calculations must avoid floating-point currency arithmetic and must reject or
separate mixed currencies.

## ERPNext integration and freshness

The adapter requests only `name`, `employee`, `employee_name`, company/personal
email, department, designation, status, and `modified`. The normalized domain
record contains the same identity/profile fields. `modifiedAt` is available in
memory but is not persisted as source evidence; `lastSynchronizedAt` records
when the application processed the mapping.

Directory connectivity is not eligibility freshness. The existing eligibility
policy requires:

1. ERPNext integration configuration when the organization requires it;
2. `lastSyncStatus = SUCCESS`, not `PARTIAL`, `FAILED`, or `RUNNING`;
3. `lastSuccessfulSyncAt` within
   `ERP_NEXT_ELIGIBILITY_MAX_AGE_MINUTES`; and
4. an ERPNext-sourced employee status synchronized at or after that successful
   run.

The observed local database had one connected integration with a successful
manual sync at `2026-10-11T13:01:46.471Z`, three matched mappings, four manual
successful runs, and three manual partial runs. It had no recorded scheduled
run. This is useful local diagnostic evidence only; freshness must be evaluated
again at each authorization and cannot be inferred from connection status.

## Lending data and calculable history

There is no separate loan-application table in the baseline flow. A
`Loan` in `REQUESTED` state is the pre-transaction application/acceptance
intent. `APPROVED`, `ACTIVE`, `OVERDUE`, `REPAID`, `DEFAULTED`, and `CANCELLED`
represent later lifecycle states. A `LendingOffer` supplies the funded product
terms; its database state is checked against the Arc contract before an
authorization is signed.

The sanitized local snapshot contained:

- 2 requested, 2 approved, 4 active, 2 overdue, and 4 repaid loans;
- 10 completed repayment records; and
- 2 exhausted/funded offers plus 6 active legacy offers.

These counts may include development fixtures and are not production-quality
training or validation data. No local defaulted loan was observed, although the
schema supports the state. The sample is far too small and uncontrolled to
claim predictive performance or fairness.

For current bullet loans, usable derived features are:

- proposed repayment = principal + fee;
- current remaining agreed obligation = max(principal + fee - completed
  repayments, 0);
- projected principal exposure = active/overdue/defaulted outstanding
  principal + proposed principal;
- active-loan count from the same obligation statuses;
- days overdue = max(ceil((evaluation time - due date) / one day), 0);
- on-time completion from `REPAID` with `closedAt <= repaymentDueAt`;
- late history from `OVERDUE` or late closure; and
- default history from explicit `DEFAULTED` status.

Affordability cannot be calculated without a verified income denominator.
Using available balance, offer size, job title, department, or email domain as
a substitute would be unsupported.

## Architecture and controls

- Authentication uses a hashed server-side session cookie resolved to an
  `AuthenticatedActor` containing the tenant and role.
- `requireEmployee` and `requireEmployerAdmin` enforce role separation, and
  repositories repeat organization filters. Employees cannot review their own
  decisions.
- Sensitive POST routes perform trusted-origin validation, rate limiting, Zod
  validation, and centralized error translation.
- Prisma migrations are append-only timestamped SQL directories. Monetary
  columns use `BigInt`, identifiers use UUIDs, and tenant-owned relations use
  composite organization foreign keys.
- The existing audit system records organization, loan/offer/repayment,
  actor/target, event type, timestamp, and JSON metadata without deleting
  financial history.
- The older `LoanDecisionEvaluation` subsystem classifies already-originated
  loans for monitoring. It is not an origination or credit-approval engine and
  should remain separate.

The worktree currently also contains `LoanOriginationDecision` and
`LoanOriginationOverride` models and corresponding uncommitted migrations.
Those store a version, immutable input/affordability snapshots, nullable score,
reason codes, status, reviewer, rationale, and timestamps. Their presence must
not be confused with evidence that income or tenure data exists.

## Required schema and integration work

For a review-only deterministic v1, the existing uncommitted decision snapshot
and override tables are sufficient if retained, migrated, and reviewed. A
production automatic-affordability version additionally requires:

1. A trusted income-evidence integration and model containing net amount,
   currency, pay period, evidence type/provider, source reference, verified
   timestamp, validity window, and revocation/supersession state.
2. An employment start date with ERPNext source provenance and synchronization
   timestamp. The connector must request the official field; tenure must not be
   inferred from account or mapping creation dates.
3. A repayment-schedule/installment model before any installment-level burden
   or delinquency feature is introduced.
4. Explicit currency-handling rules if organizations can originate more than
   one currency.
5. Backtesting/fairness data and governance before describing score bands as
   predictive risk estimates.

A separate `LoanApplication` entity is not mandatory for the controlled Arc
flow, but would make the distinction between an unexecuted request and an
on-chain loan clearer. If `Loan(status=REQUESTED)` remains the application, its
concurrency, cancellation, and immutable-decision semantics must stay explicit.

## Proposed integration point

The safe integration point is `POST
/api/lending-offers/{offerId}/acceptance-intents`, inside the authenticated
employee borrow preparation flow and **before** issuing the short-lived Arc
authorization signature. At that point the application already has the tenant,
employee membership, directory freshness, owned wallet, funded database offer,
matching on-chain offer, policy, obligations, and exact proposed repayment.

The decision should be evaluated and persisted under a per-application lock
with a unique `(application/loan ID, model version)` idempotency key. A missing
required source must yield review, and hard policy/identity/freshness failures
must not be overridable by a high score. Employer review belongs behind the
existing employer-admin API with an immutable rationale and audit event. The
wallet transaction must remain impossible until the decision is authorized;
confirmation after broadcast is too late to be the primary gate.

## Final recommendation

**BLOCKED** for an automatically approving scoring engine because verified
income and employment tenure do not exist, scheduled-sync evidence was not
observed locally, and the available historical sample is not suitable for
model validation.

**GO** for a transparent rules-only, manual-review-first implementation that
uses existing policy, exposure, repayment, and employee-trust evidence while
returning `REVIEW_REQUIRED` whenever income or tenure is unavailable. That v1
must be described as a policy aid, not a predictive credit model.
