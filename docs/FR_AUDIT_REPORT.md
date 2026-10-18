# QastFund functional-requirements audit

Audit date: 2026-10-18  
Source of truth: [`FR.md`](./FR.md)  
Scope: repository implementation, local PostgreSQL schema/migrations, automated
tests, checked-in deployment configuration, and existing controlled-pilot
evidence. No production certification or legal opinion is implied.

## Executive result

QastFund implements the core single-lender, organization-scoped lending flow:
employee synchronization, funded offers, borrower application and manual
review, Circle wallet authorization, Arc settlement, installment schedules,
partial repayment, payroll evidence/proposals, delinquency handling, and chain
reconciliation. This audit closed two clear requirements gaps:

- ERPNext `date_of_joining` is now synchronized and converted into completed
  employment months for origination evidence (FR-20).
- Each overdue threshold now creates idempotent notices for both the borrower
  and an employer administrator, with audience-specific content and links
  (FR-16/FR-17).

The largest remaining gaps are architectural or policy-dependent: a loan still
has one lender, reports are placeholders, the notification catalogue is
incomplete, there is no separate platform-administrator role, database-level
append-only enforcement is not proven, production key custody is not complete,
and jurisdiction-specific compliance rules are not specified. The application
remains suitable only for the documented controlled Arc Testnet pilot, not
public or production lending.

Final FR-01–FR-44 totals: **32 PASS, 9 PARTIAL, 2 FAIL, 1 BLOCKED**. Before
the changes in this audit the totals were **30 PASS, 11 PARTIAL, 2 FAIL,
1 BLOCKED**.

## Method and status definitions

The audit traced each normative statement in `FR.md` to schema, application,
route/UI, job, contract, and test evidence. Existing prose was not accepted as
proof without corresponding implementation or executable evidence.

- **PASS** — implemented with direct code and automated-test evidence.
- **PARTIAL** — a meaningful subset exists, but the requirement is not complete.
- **FAIL** — no conforming implementation exists or the present architecture
  contradicts the requirement.
- **BLOCKED** — completion depends on missing business, legal, provider, or
  production-environment authority/evidence.
- **NOT TESTED** — implementation may exist but was not exercised in this audit.

“Initial” is the status before this audit’s changes; “Final” includes them.

## Architecture and implementation inventory

| Area          | Implementation                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework/UI  | Next.js 16.4 App Router, React 19, Server Components by default, client components for forms and wallet operations; global design tokens and local shared UI primitives.                                          |
| Routing       | Public routes under `src/app/(public)`, employee routes under `src/app/(employee)/app`, employer routes under `src/app/(employer)/employer`, authenticated profile route, and Route Handlers under `src/app/api`. |
| Authorization | Database-resolved sessions and organization memberships in `src/modules/auth`; page guards and server-side role/ownership checks.                                                                                 |
| Persistence   | PostgreSQL through Prisma 7; schema in `prisma/schema.prisma`; sequential SQL migrations in `prisma/migrations`.                                                                                                  |
| Lending       | `src/modules/lending`, `src/modules/loans`, `src/modules/policies`, `src/modules/loan-decisions`, and `src/modules/repayment-plans`.                                                                              |
| Wallet/chain  | Circle Modular Wallet integration in `src/modules/arc-wallet`; Arc escrow contracts V1–V3 in `contracts`; receipt validation and reconciliation in `src/modules/blockchain-reconciliation`.                       |
| ERP/payroll   | Read-only employee sync in `src/modules/employee-directory`; salary-slip evidence in `src/modules/payroll-integration`; authorized proposal/reconciliation workflows in `src/modules/payroll-operations`.         |
| Automation    | Bearer-protected internal routes for ERPNext sync, Arc reconciliation, repayment operations, and repayment agent runs; scheduler in `scripts/run-arc-reconciliation-scheduler.mjs`.                               |
| Operations    | Health/readiness endpoints, monitored jobs, operational incidents, backup/restore scripts, Docker Compose and Caddy deployment configuration.                                                                     |
| Test estate   | Vitest unit/database/route/UI suites, Hardhat contract tests, local-chain tests, security/configuration checks, and verification scripts in `scripts`.                                                            |

## Role and boundary requirements

| ID      | Requirement                                                                       | Initial | Final | Evidence and gap                                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------- | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ROLE-01 | Employee/Borrower can request and repay loans.                                    | PASS    | PASS  | Employee borrow/loan routes, `borrow-from-offer.ts`, repayment APIs and UI.                                                                                                                 |
| ROLE-02 | Employee/Lender can offer funds and track lending.                                | PASS    | PASS  | Lending offer APIs/UI and lender portfolio queries. The same `EMPLOYEE` membership can borrow and lend.                                                                                     |
| ROLE-03 | Employer/HR/Payroll manages employees, policy, reviews, payroll, and delinquency. | PASS    | PASS  | Employer guards and routes for employees, policies, decisions, payroll, monitoring, and delinquency.                                                                                        |
| ROLE-04 | Separate Administrator capability.                                                | FAIL    | FAIL  | `MembershipRole` contains only `EMPLOYER_ADMIN` and `EMPLOYEE`; no platform/system administrator role or permission model is defined. **High risk; product/authorization design required.** |
| ROLE-05 | Repayment Agent is a constrained service actor.                                   | PASS    | PASS  | Dedicated cron secret, mandates, policy validation, approval requests, action/run records, and receipt verification in `src/modules/repayment-agent`.                                       |
| BND-01  | Marketplace is restricted to an organization.                                     | PASS    | PASS  | Organization ID is derived from the authenticated session and applied throughout offer/loan repositories; cross-tenant tests exist.                                                         |
| BND-02  | Employer funds are excluded unless explicitly designed later.                     | PASS    | PASS  | Offers belong to employee memberships; employer actions do not move lender funds.                                                                                                           |
| BND-03  | Payroll deductions require explicit authorization and reconciliation.             | PASS    | PASS  | `authorizePayrollDeduction`, employer review, external-reference submission, and verified result reconciliation.                                                                            |
| BND-04  | On-chain state changes only after confirmed, verified transactions.               | PASS    | PASS  | Persisted intents, hash binding, exact event/participant/amount checks, finality-aware reconciliation.                                                                                      |

## Functional traceability matrix

| ID    | Requirement                                                                                       | Initial | Final   | Implementation/evidence                                                                                                                                                         | Gap, risk, and planned disposition                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-01 | Borrower application includes amount and duration.                                                | PASS    | PASS    | Borrow form and schemas accept amount plus 1/2/3-month term; quote and borrow APIs persist the selected term.                                                                   | Offer duration caps the permitted term.                                                                                                                                          |
| FR-02 | Eligibility/decision uses configured rules and verified evidence; incomplete data goes to review. | PASS    | PASS    | Versioned deterministic origination engine, employee freshness, policy/exposure checks, salary evidence, reason codes, immutable employer review.                               | No approved scoring/affordability policy exists; manual-review-first is intentional.                                                                                             |
| FR-03 | Partial loan funding / accepting less than maximum.                                               | PASS    | PASS    | Borrower chooses an amount within offer min/max and remaining capacity; tests cover offer capacity.                                                                             | This is partial draw from one offer, not multi-lender syndication.                                                                                                               |
| FR-04 | 1/2/3-month repayment plan with installments, dates, and balances.                                | PASS    | PASS    | `SUPPORTED_REPAYMENT_TERM_MONTHS`, exact schedule generation, plan/installment tables, employee loan UI, `repayment-plan.test.ts`.                                              | —                                                                                                                                                                                |
| FR-05 | Required lifecycle states.                                                                        | PARTIAL | PARTIAL | Loan states include requested, approved, submitted, active, overdue, repaid, cancelled, defaulted; review and funding are represented in related decision/offer state.          | Exact `UNDER_REVIEW`, `FUNDED`, and `REJECTED` loan enums are absent. Consolidate the cross-entity state model before changing persisted enums. **Medium risk.**                 |
| FR-06 | Lender offers an amount.                                                                          | PASS    | PASS    | Lending offer form/API and funded-offer workflow.                                                                                                                               | —                                                                                                                                                                                |
| FR-07 | Show available, committed, deployed liquidity.                                                    | PASS    | PASS    | Lender portfolio separates pending, reserved/committed, disbursed/deployed, repaid, and outstanding values.                                                                     | —                                                                                                                                                                                |
| FR-08 | Match requests to contributions.                                                                  | PASS    | PASS    | Employee marketplace filters eligible funded offers and borrower explicitly selects one.                                                                                        | Matching is borrower-directed, not an optimizer.                                                                                                                                 |
| FR-09 | Multiple lenders can collectively fund one loan.                                                  | FAIL    | FAIL    | `Loan.lenderMembershipId` and `Loan.lendingOfferId` are singular; escrow offer acceptance produces one lender per loan.                                                         | Requires allocation/participation entities, contract changes, accounting, UI, and migration strategy. **Critical architectural gap; separate design project.**                   |
| FR-10 | Lender portfolio shows committed funds, active loans, repayments, earnings.                       | PASS    | PASS    | Employee lending page and repository aggregate the required balances and repayment history.                                                                                     | —                                                                                                                                                                                |
| FR-11 | Committed funds cannot be withdrawn.                                                              | PASS    | PASS    | Offer capacity/status rules and escrow custody prevent reuse after reservation/acceptance; status transitions are checked.                                                      | No general wallet “withdraw committed funds” command exists.                                                                                                                     |
| FR-12 | Monitor upcoming, due, completed, failed, overdue repayments.                                     | PASS    | PASS    | Installment derivation, loan monitoring, operational health, payroll status, and delinquency cases.                                                                             | —                                                                                                                                                                                |
| FR-13 | Agent acts only with explicit authorization and limits.                                           | PASS    | PASS    | Mandate consent, caps, expiry/revocation, policy planner/validator, passkey approvals, and audit records.                                                                       | —                                                                                                                                                                                |
| FR-14 | Partial repayments reduce balance and recalculate remaining obligation.                           | PASS    | PASS    | Escrow V3 partial repayment, verified receipt handling, allocation logic, outstanding balance/progress UI, regression tests.                                                    | Legacy V1 loans remain full-repayment only by contract design.                                                                                                                   |
| FR-15 | Failed/insufficient/unauthorized repayments are recorded and retryable.                           | PASS    | PASS    | Persisted intents and agent actions retain failure codes; ambiguous hashes are recovered rather than duplicated; retries are idempotent.                                        | —                                                                                                                                                                                |
| FR-16 | Notify employee and employer when overdue.                                                        | PARTIAL | PASS    | `evaluateOverdueInstallments` now creates recipient-scoped, idempotent borrower and employer notices at each threshold; delivery failures persist and can retry.                | Interactive provider delivery was not tested; HTTP sender behavior is mocked.                                                                                                    |
| FR-17 | Recommend actions without automatic employment penalties.                                         | PASS    | PASS    | Delinquency recommendations are review/contact/reconciliation actions; employee and employer notices explicitly avoid automatic employment action.                              | —                                                                                                                                                                                |
| FR-18 | Reconciliation updates loan, lender, transaction, and schedule state.                             | PASS    | PASS    | Chain journal/event reconciler and repayment allocation update financial views idempotently.                                                                                    | —                                                                                                                                                                                |
| FR-19 | Sync employee records from HR/ERP.                                                                | PASS    | PASS    | Bounded, fail-closed ERPNext employee adapter, scheduled/manual sync, stable mapping, lifecycle counters, invitations.                                                          | —                                                                                                                                                                                |
| FR-20 | Use authorized employment status, salary, and tenure data.                                        | PARTIAL | PASS    | Status sync plus submitted salary evidence already existed; this audit added validated `date_of_joining`, persisted `employmentStartedAt`, and completed-month tenure evidence. | Live ERPNext needs a fresh sync before existing mappings gain tenure.                                                                                                            |
| FR-21 | Integrate approved deductions and reconciliation into payroll workflow.                           | PARTIAL | PARTIAL | Employee authorization, employer review, proposal states, ERP reference, verified result reconciliation, salary-slip retrieval/draft calculation.                               | QastFund deliberately does not submit/cancel ERPNext payroll documents; production payroll write authority and compatible HRMS deployment are absent. **High operational risk.** |
| FR-22 | Detect payroll discrepancies.                                                                     | PASS    | PASS    | Proposed, actual, partial, failed, and reconciled amounts/statuses are persisted with external references and visible to employer operations.                                   | —                                                                                                                                                                                |
| FR-23 | Handle termination, unpaid leave, and other changes.                                              | PARTIAL | PARTIAL | Active/inactive/suspended/missing employee changes fail closed and revoke sessions/access without mutating loans.                                                               | Unpaid leave and arbitrary ERPNext statuses require an approved mapping and business policy. **Medium policy gap.**                                                              |
| FR-24 | Handle API failure, duplicates, and sync errors without duplicate financial action.               | PASS    | PASS    | Retries/bounds, complete-snapshot commit, idempotency keys, unique constraints, transaction locks, event journal, and ambiguous-state recovery.                                 | —                                                                                                                                                                                |
| FR-25 | Associate a wallet with each user/account.                                                        | PASS    | PASS    | One Arc Testnet Circle Modular Wallet per user/network with ownership challenge and unique address.                                                                             | —                                                                                                                                                                                |
| FR-26 | Support loan disbursement.                                                                        | PASS    | PASS    | Authorized escrow acceptance transfers funded USDC and activates only after verified receipt/event.                                                                             | —                                                                                                                                                                                |
| FR-27 | Verify network, token, amount, recipient, status, confirmation.                                   | PASS    | PASS    | Fixed Arc chain/USDC/contract configuration, exact receipt/event checks, confirmations and contract-state validation.                                                           | —                                                                                                                                                                                |
| FR-28 | Link on-chain transactions to loans/repayments.                                                   | PASS    | PASS    | Unique transaction hashes, intent IDs, chain loan/offer IDs, audit events, and reconciliation journal links.                                                                    | —                                                                                                                                                                                |
| FR-29 | Prevent duplicate, unauthorized, and invalid transitions.                                         | PASS    | PASS    | Database constraints, idempotency, advisory locks, state predicates, tenant/owner checks, signed authorization expiry/nonces.                                                   | —                                                                                                                                                                                |
| FR-30 | Provide transaction history.                                                                      | PASS    | PASS    | Wallet transfer history, loan repayments/allocations, lender repayment history, and audit timelines.                                                                            | —                                                                                                                                                                                |
| FR-31 | Represent pending/failed/reconciled transactions without premature balance updates.               | PASS    | PASS    | Intent/status models separate submission from verified completion; balances/lifecycle update after receipt or reconciled evidence.                                              | —                                                                                                                                                                                |
| FR-32 | Notifications for decisions, funding, upcoming due, success/failure, overdue.                     | PARTIAL | PARTIAL | Invitation/password mail, repayment-agent borrower notices/approvals, and borrower+employer overdue notices exist.                                                              | No complete event-notification catalogue for loan decisions, funding, generic success/failure, or scheduled upcoming reminders. **High UX/operations gap.**                      |
| FR-33 | Employer dashboard shows employee, funds, loans, repayments, alerts, payroll exceptions.          | PASS    | PASS    | Employer overview plus loans, monitoring, payroll, delinquency, employees, policy, and integration pages.                                                                       | Data is split across focused pages rather than one oversized dashboard.                                                                                                          |
| FR-34 | Employee dashboard shows capacity, active loans, schedules, history, wallet.                      | PASS    | PASS    | Employee dashboard, borrow marketplace, lending portfolio, loan detail, repayment progress, and wallet pages.                                                                   | —                                                                                                                                                                                |
| FR-35 | Audit reports for applications, approvals, disbursements, repayments, overrides.                  | FAIL    | FAIL    | Loan-level append-only audit events exist, but `/employer/reports` is a placeholder and there is no report/export/query covering all categories.                                | Build authorized filters/export with privacy limits. **High auditability gap.**                                                                                                  |
| FR-36 | Portfolio reporting for lending, utilization, defaults, repayments.                               | PARTIAL | PARTIAL | Employer overview and lender portfolio expose current aggregates and loan lists.                                                                                                | No historical reporting/trend/export surface; `/employer/reports` is a placeholder. **Medium gap.**                                                                              |
| FR-37 | Secure authentication and session management.                                                     | PASS    | PASS    | Scrypt passwords, random hashed sessions, HttpOnly/SameSite cookies, production Secure flag, reset/revocation flows and tests.                                                  | Deployed cookie evidence remains an operational gate.                                                                                                                            |
| FR-38 | RBAC for employees, employer admins, admins, and agent services.                                  | PARTIAL | PARTIAL | Employee/employer guards and dedicated secret-authenticated internal services are enforced server-side.                                                                         | Separate platform Administrator is missing; agent identity is service-secret based rather than a general RBAC principal. **High authorization-design gap.**                      |
| FR-39 | Explicit consent for loan terms, repayment authorization, payroll deductions.                     | PASS    | PASS    | Borrow confirmation, wallet/passkey authorization, agent mandate/approval, and explicit payroll authorization state.                                                            | Legal wording/version retention should be reviewed before production.                                                                                                            |
| FR-40 | Tamper-resistant financial and administrative records.                                            | PARTIAL | PARTIAL | Financial records are append-oriented, tenant-linked, constrained, and audited; chain receipts add external evidence.                                                           | No verified DB role/trigger/WORM control prevents privileged direct update/delete. **High production-control gap.**                                                              |
| FR-41 | Secure keys/secrets, restricted access, rotation.                                                 | PARTIAL | PARTIAL | Server-only env separation, ignored env files, encrypted ERP credentials, redacted errors, dedicated cron secrets.                                                              | No demonstrated KMS/HSM custody or rehearsed immutable escrow signer rotation. **Critical production gate.**                                                                     |
| FR-42 | Protect salary, employment, identity, and financial data.                                         | PARTIAL | PARTIAL | Tenant/role scoping, minimal ERP field selection, secret encryption/redaction, origin checks, sanitized health output.                                                          | Encryption-at-rest guarantees, retention/deletion policy, access review, DPIA/privacy evidence, and independent RLS testing are absent. **High production/legal gap.**           |
| FR-43 | Enforce limits and route exceptions to review.                                                    | PASS    | PASS    | Organization lending policy, offer/loan constraints, exposure/capacity rules, manual-review reason codes, agent caps, DB checks.                                                | —                                                                                                                                                                                |
| FR-44 | Support jurisdiction-specific lending/payroll/privacy requirements.                               | BLOCKED | BLOCKED | No jurisdiction configuration or approved legal rule set is present.                                                                                                            | Requires named launch jurisdictions and legal/compliance requirements before implementation. **Critical release blocker.**                                                       |

## End-to-end workflow trace

| ID    | Workflow step                                                                    | Status | Evidence                                                                                                       |
| ----- | -------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| WF-01 | Employer onboards and connects employee source.                                  | PASS   | Employer onboarding/integration pages, encrypted credentials, connection test and sync.                        |
| WF-02 | Employees are synchronized and gain scoped access.                               | PASS   | Stable ERP mappings, invitations, activation, lifecycle/session handling.                                      |
| WF-03 | Lender contributes funds.                                                        | PASS   | Circle wallet enrollment, funded-offer intent, Arc receipt confirmation.                                       |
| WF-04 | Borrower applies with amount and repayment option.                               | PASS   | Quote/borrow forms and APIs, 1/2/3-month schedule selection.                                                   |
| WF-05 | Decision/manual review then borrower-authorized disbursement.                    | PASS   | Deterministic decision, immutable override, short-lived signed authorization, verified `LoanStarted`.          |
| WF-06 | Scheduled/partial repayment, payroll operations, monitoring, and reconciliation. | PASS   | Plans/installments, manual and agent repayments, payroll proposals/evidence, delinquency jobs, Arc reconciler. |

FR-09 means WF-03–WF-05 currently describe a single lender per loan, not pooled
funding.

## Ambiguities, overlaps, and contradictions in FR.md

- “Partial loan funding” (FR-03) can mean a borrower accepting less than an
  offer or several lenders partially filling one request. FR-09 explicitly
  covers the latter; this report treats FR-03 as a partial draw and FR-09 as
  syndication.
- FR-05 names loan statuses, while the implementation intentionally splits
  review status, funding status, and on-chain submission status across related
  entities. Treating every word as one enum would lose useful distinctions.
- FR-12, FR-16, FR-17, and FR-32 overlap. Monitoring can pass while the broader
  notification catalogue remains partial.
- FR-18, FR-27, FR-28, and FR-31 overlap around transaction confirmation and
  reconciliation; the shared invariant is that unverified submissions never
  update settled financial state.
- “Administrator” is not defined as platform-wide, organization-wide, or
  operational. The code has employer admins but no separate administrator role.
- FR-21 requires payroll integration, but the current security boundary is
  intentionally read-only toward ERPNext payroll. External document submission
  cannot be inferred safely without explicit authority and provider readiness.
- FR-44 cannot be implemented generically: lending, payroll, privacy, notices,
  retention, and licensing requirements depend on named jurisdictions.

## Changes implemented by this audit

| File                                                                                    | Purpose                                                                                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                                  | Persist verified employment start date; allow one delinquency notice per case/threshold/recipient.       |
| `prisma/migrations/20261018120000_fr_tenure_and_delinquency_recipients/migration.sql`   | Add tenure evidence column and replace the one-recipient uniqueness constraint.                          |
| `src/modules/employee-directory/domain/employee-directory.ts`                           | Add employment-start evidence to the external employee contract.                                         |
| `src/modules/employee-directory/application/ports/employee-directory-repository.ts`     | Carry employment-start evidence through sync decisions and match context.                                |
| `src/modules/employee-directory/infrastructure/erpnext-employee-directory-adapter.ts`   | Request and strictly validate ERPNext `date_of_joining`.                                                 |
| `src/modules/employee-directory/application/synchronize-employees.ts`                   | Propagate, compare, and retain joining dates through complete snapshot syncs.                            |
| `src/modules/employee-directory/infrastructure/prisma-employee-directory-repository.ts` | Read/write normalized joining dates.                                                                     |
| `src/modules/loan-decisions/infrastructure/prisma-origination-decision-repository.ts`   | Calculate completed calendar months and include them in immutable decision input evidence.               |
| `src/modules/payroll-operations/index.server.ts`                                        | Create and deliver distinct borrower/employer overdue notices with appropriate content and destinations. |
| `tests/erpnext-employee-directory.test.ts`                                              | Cover leap-day normalization, invalid dates, and sync propagation.                                       |
| `tests/origination-decision.test.ts`                                                    | Cover calendar tenure calculation and future-date rejection.                                             |
| `tests/payroll-operations.test.ts`                                                      | Verify two-recipient idempotent overdue notifications and borrower loan link.                            |
| `tests/financial-invariants-database.test.ts`                                           | Verify the recipient-scoped unique index.                                                                |

No multi-lender model, new administrator role, ERPNext write operation, or
jurisdiction rule was invented because those changes require product, contract,
authorization, and legal decisions beyond the supplied specification.

## Verification

Focused tests for directory sync, origination tenure, payroll/delinquency, and
database invariants: **PASS — 4 files, 62 tests**.

- Full isolated test suite: **PASS — 83 files passed, 1 skipped; 518 tests
  passed, 1 skipped**. The skipped disaster-recovery test is opt-in.
- ESLint: **PASS — no errors or warnings**.
- Prisma validation: **PASS**.
- Prisma migration status: **PASS — 57 migrations, database up to date**.
- Migration replay: **PASS** against the disposable isolated-test database.
- `git diff --check`: **PASS**; Git reported only line-ending conversion
  notices.
- Production build: the optimized Next.js bundle **compiled successfully**, but
  the build **FAILED during TypeScript checking** on seven pre-existing
  `unknown`-typing errors in `scripts/demo/repayment-agent-demo.ts` (lines 82,
  115, 119, 120, and 283) and `scripts/deploy-lending-escrow.ts` (lines 86–87).
  These scripts were outside the functional-requirements fixes and were not
  changed or falsely reported as passing.

Interactive browser testing was not available in this tool session; responsive
and keyboard behavior therefore remains **NOT TESTED** here rather than claimed
as verified. Existing automated UI tests remain part of the full suite.

## Recommended next implementation sequence

1. Define and build FR-35/FR-36 authorized audit and portfolio reports.
2. Define an event catalogue and delivery preferences for the missing FR-32
   notifications, including upcoming due reminders.
3. Decide whether FR-09 pooled funding is truly in MVP scope; if yes, redesign
   the database, accounting, contracts, reconciliation, and UI together.
4. Define platform Administrator semantics and least-privilege service identity
   for FR-38.
5. Select launch jurisdictions and close FR-40–FR-44 with legal/privacy review,
   managed key custody, database immutability controls, and deployment evidence.
