# Explainable loan decision engine v1

## Controlled-pilot policy

`loan-decision-manual-review-v1` is a deterministic, manual-review-first
policy gate. It does not use a credit score, statistical model, feature
weights, or automatic approval band. The repository contains no approved
business, risk, or compliance basis for those values, and the available
ERPNext data does not include verified income or employment tenure.

The engine runs before the server issues a short-lived Arc borrow
authorization. It stores an immutable input snapshot, reason codes, policy
version, source timestamps, evaluation timestamp, and `score: null`. A
transaction remains blocked until an active employer administrator records one
immutable approval with a rationale. Rejection cancels the application.

## Outcomes

- `NOT_ELIGIBLE`: a verified hard gate failed. Current hard gates are invalid
  application terms, inactive employment, the configured employer loan limit,
  the configured product limit, and the configured outstanding-principal
  limit. These are server-side checks and cannot be overridden.
- `REVIEW_REQUIRED`: no verified hard gate failed, but an authorized human
  must decide the request. Missing or unverified income and unavailable tenure
  always produce this outcome. Identity, directory freshness, and financial
  consistency failures are preserved for investigation and must be resolved
  before an approval can authorize signing.
- `APPROVAL_CONSIDERATION`: retained only as a historical database enum value.
  The active v1 engine never emits it, and historical score-based records with
  this status cannot authorize a transaction.

There is no automatic approval outcome in the controlled pilot.

## Evidence and reason codes

The evaluator distinguishes recorded facts from missing evidence:

| Input                                | Source                                                          | Treatment                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee identity and status         | Tenant membership, matched ERPNext mapping, complete/fresh sync | Inactive is ineligible; unresolved, unverified, or stale evidence blocks approval pending correction.                                           |
| Verified income                      | No current provider or model                                    | `INCOME_UNAVAILABLE`, `INCOME_UNVERIFIED`, `INCOME_EVIDENCE_STALE`, or `INCOME_INVALID`; always review, never substituted with zero or a proxy. |
| Employment tenure                    | No current ERPNext field                                        | `EMPLOYMENT_TENURE_UNAVAILABLE`; always review. ERPNext modification time is never treated as a start date.                                     |
| Principal, fee, term, policy version | Loan and funded offer                                           | Invalid terms are ineligible. Integer minor/base units are used throughout.                                                                     |
| Employer/product limits              | Versioned lending policy and offer                              | Exact boundaries are allowed; verified exceedance is ineligible.                                                                                |
| Existing principal exposure          | Active/overdue/defaulted tenant-scoped loans                    | The requested principal is included; exceeding the configured maximum is ineligible.                                                            |
| Repayment history                    | Authoritative loan lifecycle records                            | New-to-credit, prior late repayment, and prior default are recorded as facts for the reviewer; no points are assigned.                          |
| Financial consistency                | Loan, repayment, and currency checks                            | Conflicts block approval and remain visible for reconciliation.                                                                                 |

Affordability fields record the proposed repayment and current obligations.
Burden ratio, maximum burden, maximum permitted principal, and affordability
pass/fail remain `null` because no verified income source or approved threshold
exists. Any future threshold must be separately approved, versioned,
configured, and tested before use.

## Persistence and authorization

`LoanOriginationDecision` is unique by `(loanId, modelVersion)` and by its
explicit idempotency key. Repeated evaluation of the same version returns the
existing decision. `LoanOriginationOverride` permits one immutable review and
records reviewer membership, outcome, rationale, and timestamp. Decision and
review actions append audit events.

Employee endpoints expose only safe decision metadata. Employer-admin
endpoints are tenant-scoped and expose the review evidence. Employees cannot
edit decisions, approve their own request, select a tenant, or supply a policy
limit. The final EIP-712 authorization is signed server-side only after the
current application, employee, offer, wallet, policy, and immutable review are
revalidated.

## Verified tests

The decision suite covers deterministic output, missing/unverified/stale
income, missing tenure, new-to-credit and adverse-history facts, exact and
exceeded policy boundaries, inactive employees, invalid applications,
unresolved identity, stale directory evidence, financial conflicts, human
approval, historical-score rejection, persistence idempotency, tenant
isolation, self-approval prevention, and immutable review history.

The local-chain end-to-end regression performs controlled ERPNext-style
employee synchronization, employee account and wallet setup, application,
`REVIEW_REQUIRED`, employer approval, signed authorization, disbursement,
repayment, and database/on-chain reconciliation using only local fixtures and
mock USDC.

## Blocked automatic-decision work

Automatic decisioning remains blocked pending at least: an approved and
verified net-income source with provenance and validity; an official
employment-start source; approved affordability and risk policy; currency and
repayment-schedule rules; representative outcome data; fairness and legal
review; and an explicit activation decision. None of those are implied by a
successful testnet lifecycle.
