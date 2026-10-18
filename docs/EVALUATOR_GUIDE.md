# QastFund evaluator guide

Last verified against the repository: 2026-10-18

This is the primary evaluator-facing guide to QastFund. It explains what the
system does, how the implemented workflows fit together, how to run a safe
demonstration, and where the current product stops. Requirements status is
maintained in the [functional-requirements audit](./FR_AUDIT_REPORT.md).

> **Evaluation boundary:** QastFund is approved only for a controlled,
> test-fund-only Arc Testnet validation pilot. It is not approved for public
> lending, production assets, or real payroll deductions.

## 1. Project overview

QastFund is an employer-integrated, organization-scoped peer-to-peer lending
application. Verified employees can make funds available to colleagues, apply
to borrow from a funded offer, follow an installment schedule, and make full or
partial repayments. Employer administrators manage employee eligibility,
lending policy, loan reviews, payroll-related evidence, and repayment
exceptions without becoming the owner of employee wallets or lender funds.

The project addresses five connected problems:

1. an employee may need short-term financing for an unexpected expense;
2. another employee may have liquidity available to lend;
3. both sides need transparent terms and repayment records;
4. the employer needs bounded visibility into eligibility and exceptions; and
5. blockchain submission must be reconciled with application state before a
   financial action is treated as complete.

The current system is a modular Next.js application backed by PostgreSQL. It
integrates with ERPNext/Frappe HR for employee and payroll evidence, Circle
Modular Wallets for passkey-controlled user wallets, and Arc Testnet escrow
contracts for test-USDC funding, disbursement, and repayment.

### Current maturity

| Capability                                 | Status                                     | Evaluation meaning                                                                                                                  |
| ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Local employee/employer experience         | Implemented and automated-test verified    | Can be demonstrated with deterministic synthetic records.                                                                           |
| Employee synchronization                   | Implemented and test verified              | A real demonstration needs an evaluator-controlled ERPNext instance and scoped credentials.                                         |
| Salary-slip evidence and draft calculation | Implemented and test verified              | QastFund reads submitted evidence and may create a calculated **draft**; it never submits or cancels a salary slip.                 |
| Loan review and schedules                  | Implemented and test verified              | The active policy always requires an employer-admin review unless a hard gate makes the request ineligible.                         |
| Arc funding, borrowing, and repayment      | Implemented for Arc Testnet                | A live exercise requires configured Circle/Arc services, enrolled wallets, deployed V3 escrow, test USDC, and a healthy reconciler. |
| Repayment agent                            | Implemented with bounded on-chain mandates | It cannot bypass the borrower’s mandate or guarantee collection.                                                                    |
| Multi-lender funding of one loan           | Not implemented                            | Each loan currently has one lender and one lending offer.                                                                           |
| Audit and portfolio reports                | Partially implemented                      | Data and loan-level timelines exist; `/employer/reports` remains a placeholder.                                                     |
| Production security/compliance             | Blocked                                    | Managed key custody, independent assurance, recovery evidence, and jurisdiction-specific approval remain open.                      |

## 2. Problem and proposed solution

### Problem

Unexpected expenses do not always align with payroll dates. Conventional
external borrowing can require a separate lender relationship and may not use
fresh employment evidence. Informal colleague-to-colleague lending has the
opposite problem: it can lack consistent eligibility checks, clear terms,
repayment schedules, audit records, and exception handling.

An employer may be able to verify employment or payroll facts, but it should
not automatically become the lender, wallet custodian, or debt collector. It
also must not infer that payroll deduction is lawful or authorized merely
because payroll software is connected.

### Implemented approach

QastFund combines four boundaries:

- **Organization boundary:** employees only see offers and loans belonging to
  their authenticated organization.
- **Employer evidence and review:** ERPNext provides bounded employee/payroll
  evidence; an employer administrator reviews otherwise eligible requests.
- **User-controlled settlement:** employees authorize Circle Modular Wallet
  actions with passkeys. Server approval alone cannot move their funds.
- **Verified state transitions:** transaction submission is not settlement.
  QastFund validates receipts, events, participants, token, amount, contract,
  and chain state before updating settled application state.

This differs from conventional external borrowing because the marketplace is
internal to a verified workforce and the employer supplies eligibility and
operational oversight. It does **not** prove lower cost, better financial
outcomes, regulatory compliance, or guaranteed repayment.

### Example used in this guide

Bob offers synthetic USD 1,500 of lending capacity. Alice requests USD 500
over two installments. The system records the requested principal, fee, plan,
decision evidence, employer review, and—when using the optional Arc flow—the
verified testnet transaction references. These names and amounts are fictional
development fixtures, not personal or production data.

## 3. System architecture

QastFund is a modular monolith. Pages and Route Handlers call application
services; domain modules enforce rules; infrastructure adapters communicate
with PostgreSQL, ERPNext, Circle, and Arc.

```mermaid
flowchart LR
    Browser[Evaluator browser]
    Public[Public and authentication UI]
    Employee[Employee portal /app]
    Employer[Employer portal /employer]
    API[Next.js Route Handlers]
    Domain[Application and domain modules]
    DB[(PostgreSQL)]
    ERP[ERPNext / Frappe HR]
    Circle[Circle Modular Wallet SDK]
    Arc[Arc Testnet escrow V3]
    Jobs[Internal scheduler]
    Mail[Configured email gateway]

    Browser --> Public
    Browser --> Employee
    Browser --> Employer
    Public --> API
    Employee --> API
    Employer --> API
    API --> Domain
    Domain --> DB
    Domain -->|bounded REST reads; draft calculation| ERP
    Employee -->|passkey authorization| Circle
    Circle -->|user operation| Arc
    Domain -->|RPC receipt and state reads| Arc
    Jobs -->|bearer-authenticated internal routes| API
    Domain -->|transactional notices| Mail
    Arc -->|finalized event replay| Domain
```

| Component                  | Responsibility                                                                                                | Important boundary                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Next.js frontend           | Public, employee, employer, and shared authenticated pages; server-rendered data and client wallet/forms.     | Hiding a control is not authorization; protected operations recheck the actor server-side.    |
| Route Handlers             | JSON commands/queries, validation, auth translation, and safe error envelopes.                                | External input is validated with Zod; state-changing browser requests use origin checks.      |
| Domain/application modules | Lending, loans, policy, decisions, payroll, agent, reconciliation, and operations.                            | Business state changes live here, not in UI components.                                       |
| PostgreSQL/Prisma          | Users, memberships, evidence, offers, loans, plans, intents, audit events, jobs, and reconciliation journals. | Financial values use integer minor/base units and database constraints.                       |
| ERPNext/Frappe HR          | Employee directory, joining date, and minimal salary-slip evidence.                                           | Employee sync is read-only. Payroll support does not submit/cancel salary slips.              |
| Circle Modular Wallets     | Passkey-controlled user smart accounts and user-operation submission.                                         | The application does not receive a user’s raw private key.                                    |
| Arc escrow V3              | Custodies funded test USDC; enforces offer, borrow-authorization, repayment, and agent-mandate rules.         | Testnet only. One lender funds each loan.                                                     |
| Reconciliation worker      | Replays finalized contract events into an idempotent journal and resolves known intents.                      | Unmatched/conflicting events remain visible; the worker does not fabricate financial records. |
| Email adapter              | Invitations, resets, repayment-agent messages, and borrower/employer overdue notices.                         | Real delivery depends on an externally configured provider.                                   |

Implemented details and trust boundaries are expanded in
[ARCHITECTURE.md](./ARCHITECTURE.md). Proposed or incomplete capabilities are
identified in Sections 13 and 15 below.

## 4. User roles and modules

### Employee experience

An `EMPLOYEE` membership can act as borrower, lender, or both. Lending and
borrowing access can be disabled independently by an employer administrator.

| Route/module            | Purpose and output                                                                            | Inputs and validation                                                              | Related APIs/services                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/app`                  | Capacity, active obligations, lending/borrowing activity, and next actions.                   | Active session, employee membership, organization-scoped records.                  | Dashboard repository, borrowing policy, wallet state.                   |
| `/app/onboarding`       | Employment eligibility and wallet setup status.                                               | Fresh ERP mapping when ERPNext is enabled; wallet ownership challenge.             | `/api/wallet/arc/enrollment`, challenge and completion routes.          |
| `/app/lending`          | Create and inspect the employee’s offers and portfolio.                                       | Amount, min/max loan, term, fee, expiry, policy, wallet funding state.             | `/api/lending-offers`, `/mine`, funding-intent and confirmation routes. |
| `/app/borrow`           | Browse eligible funded offers from the same organization.                                     | Excludes self-lending and unavailable/expired/ineligible offers.                   | Marketplace query and `/api/borrowing-capacity`.                        |
| `/app/borrow/[offerId]` | Quote and request a chosen amount and 1/2/3-month term.                                       | Offer capacity, policy limits, fresh employment, wallet ownership, contract state. | Quote, borrow, acceptance-intent, and confirmation APIs.                |
| `/app/loans/[loanId]`   | Terms, decision state, schedule, allocations, transaction references, and repayment controls. | Borrower ownership; repayable status; positive amount not above outstanding.       | Loan, repayment-intent, confirm, and legacy repayment APIs.             |
| `/app/agent`            | Create/revoke a bounded repayment mandate and inspect agent runs/actions.                     | Passkey confirmation; mandate caps, reserve, window, expiry, and agent address.    | Repayment-agent mandate, approval, run, and activity APIs.              |
| `/app/wallet/send`      | Send Arc Testnet USDC to a validated address.                                                 | Enrolled wallet, exact chain/token, amount, idempotency, receipt verification.     | Arc transfer prepare/authorize/submit/outcome/confirm APIs.             |

### Employer-administrator experience

`EMPLOYER_ADMIN` is organization-scoped. It is not a separate platform-wide
administrator role.

| Route/module                                     | Purpose and output                                                                                                      | Inputs and permissions                                                            | Related APIs/services                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `/employer`                                      | Workforce, liquidity, loan, repayment, and action summaries.                                                            | Active employer-admin membership.                                                 | Employer overview repository.                                  |
| `/employer/onboarding`                           | Organization name, ERPNext enablement, initial policy, and sync readiness.                                              | Employer-admin only; validated configuration.                                     | Organization onboarding services.                              |
| `/employer/employees`                            | Active/former employees, invitation status, and access controls.                                                        | Tenant-scoped employee records; audit access changes.                             | Employee and lending-access APIs.                              |
| `/employer/integrations`                         | Configure/test ERPNext and run manual sync.                                                                             | URL safety, encrypted/server credentials, status mapping, bounded pagination.     | Employee-directory services and internal scheduled sync route. |
| `/employer/policies`                             | Configure loan amount, exposure, duration, and access limits.                                                           | Valid ranges and immutable policy snapshots on resulting loans.                   | Employer lending-policy API.                                   |
| `/employer/loans` and `/employer/loans/[loanId]` | Review the organization’s applications, loans, repayments, and audit timeline.                                          | Employer-admin and matching organization.                                         | Employer loan query services.                                  |
| `/employer/monitoring`                           | Review deterministic loan-health classifications and authorized follow-up actions.                                      | Tenant/role checks and idempotent action adapter.                                 | Monitoring and employer-action modules.                        |
| `/employer/payroll`                              | Retrieve salary slips, create calculated drafts, review authorized deduction proposals, and reconcile verified results. | Employer-admin; employee mapping; explicit employee authorization for deductions. | Salary-slip and payroll-deduction APIs.                        |
| `/employer/delinquency`                          | Review overdue installments, delivery status, notes, contact, and arrangements.                                         | Employer-admin; no autonomous employment penalty.                                 | Delinquency APIs and repayment-operations job.                 |
| `/employer/reports`                              | Intended reporting entry point.                                                                                         | Employer route guard.                                                             | **Placeholder: no complete report/export implementation.**     |

## 5. End-to-end business workflows

### Onboarding and employee synchronization

1. An employer administrator registers an organization and configures policy.
2. The administrator optionally enables ERPNext, supplies a safe HTTPS base
   URL and scoped server-side credentials, maps source statuses, and tests the
   connection.
3. Manual or scheduled sync reads a complete, bounded `Employee` snapshot.
4. Stable ERPNext employee IDs are matched to organization memberships. A new
   active employee can receive an invitation; ambiguous records enter review.
5. Status, department, designation, and validated `date_of_joining` are stored.
   Missing or inactive employees lose new lending/borrowing access, but their
   historical financial records are not deleted.
6. A fresh mapped employee may enroll a Circle wallet using a one-time ownership
   challenge and passkey flow.

Failures do not apply a partial directory snapshot. Unknown statuses,
ambiguous emails, duplicate external IDs, timeouts, or incomplete pagination
produce safe review/failure state.

### Salary-slip retrieval and draft creation

- `GET /api/employer/payroll/salary-slips` retrieves a bounded list of minimal
  salary-slip fields for one mapped employee.
- Submitted salary slips (`docstatus = 1`) can be synchronized as salary
  evidence for loan review when fresh and currency-consistent.
- `POST /api/employer/payroll/salary-slips` invokes ERPNext’s calculated-draft
  workflow. The result remains a draft; QastFund does not submit or cancel it.
- A deployment without compatible HRMS/Frappe versions, required payroll
  records, or a payroll-scoped service credential cannot demonstrate this
  workflow and must label it environment-blocked.

### Lending, application, review, and disbursement

```mermaid
flowchart TD
    L[Lender creates terms] --> FI[Persist funding intent]
    FI --> PW1[Lender confirms passkey operation]
    PW1 --> OF[Escrow receives exact test USDC]
    OF --> VF[Verify receipt and OfferCreated event]
    VF --> MP[Funded offer appears in organization marketplace]
    MP --> Q[Borrower selects amount and 1/2/3-month term]
    Q --> G{Eligibility and policy gates}
    G -->|hard failure| NE[NOT_ELIGIBLE]
    G -->|otherwise| MR[REVIEW_REQUIRED]
    MR -->|employer rejects| C[CANCELLED application]
    MR -->|employer approves with rationale| A[APPROVED application]
    A --> BI[Create short-lived signed acceptance intent]
    BI --> PW2[Borrower confirms passkey operation]
    PW2 --> LS[Escrow acceptOffer transfers test USDC]
    LS --> VL[Verify LoanStarted receipt, participants, amount and state]
    VL --> AC[Loan ACTIVE; schedule visible]
```

Important implementation details:

- A borrower can draw less than an offer’s maximum or remaining capacity.
- “Partial funding” currently means a partial draw from **one** funded offer.
  Multiple lenders cannot collectively fund one loan.
- The employer review records a decision; it does not sign the borrower’s
  transaction or move money.
- A successful wallet submission is not enough. The application activates the
  loan only after exact receipt/event and contract-state verification.

### Repayment and reconciliation

```mermaid
flowchart TD
    S[Active or overdue loan] --> CH{Repayment method}
    CH -->|borrower initiated| RI[Create persisted repayment intent]
    CH -->|agent considers payment| OBS[Observe obligation, wallet, allowance and mandate]
    OBS --> PLAN[Rule-based or configured planner proposes action]
    PLAN --> VAL{Deterministic validation}
    VAL -->|outside mandate or policy| NOTE[Reject plan and notify/escalate]
    VAL -->|requires passkey approval| APR[Create expiring approval request]
    VAL -->|authorized within mandate| RI
    APR -->|borrower confirms| RI
    RI --> TX[Submit partial or final Arc repayment]
    TX --> RC{Receipt and event verified?}
    RC -->|yes| AL[Allocate payment to installments]
    AL --> BAL[Update outstanding balance and status]
    RC -->|pending/unknown| KEEP[Keep intent and hash; reconcile later]
    RC -->|reverted| FAIL[Record failure; allow bounded safe retry]
    KEEP --> RECON[Finalized event reconciliation]
    BAL --> DUE{Outstanding overdue?}
    DUE -->|yes| DEL[Open delinquency case; notify borrower and employer]
    DUE -->|no| DONE[Continue schedule or mark REPAID]
```

Repayments are allocated to installments in sequence. A V3 repayment may be
smaller than the outstanding amount; the remaining balance stays payable. A
final verified repayment closes the on-chain obligation. Legacy V1 escrow
loans retain their original full-repayment behavior.

### Payroll deductions and overdue handling

1. QastFund generates or accepts a deduction proposal against an installment.
2. The employee explicitly authorizes the proposal.
3. An employer administrator approves or rejects it with a rationale.
4. The employer records the external payroll document/reference when submitted
   through the employer’s authorized process.
5. QastFund reconciles the verified actual amount. A difference between
   proposed and actual amounts remains visible as partial/discrepant state.
6. The scheduled repayment-operations job derives overdue installment state,
   opens or resolves delinquency cases, and sends idempotent threshold notices
   to the borrower and an employer administrator.

QastFund does not infer consent, silently alter payroll, or impose employment
penalties. Unpaid leave and organization-specific employment statuses require
an approved mapping and policy.

## 6. Loan decision model

The active model is `loan-decision-manual-review-v1`. It is deterministic and
has no trained model, score, weight table, automatic approval band, income
ratio threshold, or invented credit score.

### Recorded inputs

| Group                  | Implemented inputs                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee               | active status, verified/fresh source state, identity mapping integrity, completed employment months when `date_of_joining` exists, status verification time |
| Application            | principal, fee, term, repayment structure/installment count, policy version, employer maximum, offer maximum                                                |
| Affordability evidence | submitted ERPNext net pay when fresh and currency-consistent, evidence timestamps/reference, existing monthly obligations                                   |
| Exposure               | current outstanding principal and configured maximum exposure                                                                                               |
| History                | completed-on-time, late, and defaulted prior loans                                                                                                          |
| Integrity              | required-source freshness and financial-record consistency                                                                                                  |

### Outcomes and rules

The engine returns `NOT_ELIGIBLE` when a hard gate fails:

- invalid application data;
- inactive employee;
- employer loan limit exceeded;
- product/offer loan limit exceeded; or
- maximum exposure exceeded.

Otherwise it returns `REVIEW_REQUIRED` and adds
`MANUAL_REVIEW_REQUIRED`. Missing tenure, unavailable/unverified/stale income,
stale employment evidence, identity ambiguity, new-to-credit status, and prior
late/default history are recorded as reason codes. They are not silently
replaced with fabricated values.

An employer administrator may approve or reject a review-required decision
with a 20–1000 character rationale. Mandatory integrity/eligibility failures
cannot be overridden into authorization. The decision input snapshot and
override are persisted for audit.

## 7. Repayment agent

The repayment agent monitors a borrower’s eligible Arc V3 loans and proposes
bounded actions. It can use the deterministic rule-based planner or a
configured planner whose output is still checked by deterministic policy.

### Fixed application policy

| Control                                            | Implemented default              |
| -------------------------------------------------- | -------------------------------- |
| Minimum useful partial payment                     | 1 USDC                           |
| Maximum actions per run                            | 3                                |
| Maximum rejected plans per run                     | 2                                |
| Safe retries for the same repayment ID             | 1                                |
| Due-soon window                                    | 72 hours                         |
| Passkey approval lifetime                          | 48 hours                         |
| Receipt wait before later monitoring               | 60 seconds                       |
| Minimum spacing between agent payments on one loan | 1 hour                           |
| Submitted transaction considered dropped after     | 10 minutes without node evidence |

The borrower’s on-chain mandate narrows authority further through an exact
agent address, maximum per repayment, rolling-period maximum, minimum wallet
reserve, earliest execution window, expiry, and nonce. Escrow V3 checks these
limits on chain.

The agent may pay when the mandate, allowance, balance, reserve, timing, and
caps permit; request a borrower passkey approval; wait; or notify. It persists
runs, steps, actions, attempts, transaction IDs, and verified outcomes.

The agent cannot:

- move funds to an arbitrary recipient;
- exceed contract-enforced mandate caps;
- collect more than the outstanding obligation;
- bypass a revoked/expired mandate;
- alter employment status or impose employment penalties; or
- guarantee repayment when the wallet lacks funds/allowance or authorization.

## 8. Technology stack

Versions below come from `package.json` or checked-in runtime configuration.

| Technology                  | Verified version/configuration                            | Role                                                                                           |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| TypeScript                  | 5.x                                                       | Application, scripts, tests, and configuration.                                                |
| Next.js                     | 16.4.0                                                    | App Router UI, Server Components, and Route Handlers.                                          |
| React                       | 19.2.8                                                    | User interfaces and interactive client flows.                                                  |
| Tailwind CSS                | 4.x                                                       | Styling and shared design tokens/primitives.                                                   |
| PostgreSQL                  | Compose image 17                                          | Transactional application system of record.                                                    |
| Prisma                      | 7.10.0                                                    | Typed data access, schema, and SQL migrations.                                                 |
| Zod                         | 4.6.5                                                     | Environment and request validation.                                                            |
| Circle Modular Wallets Core | 1.0.13                                                    | Passkey-controlled modular wallet integration.                                                 |
| viem                        | 2.46.3                                                    | EVM RPC, encoding, receipts, logs, and contract reads.                                         |
| Solidity                    | 0.8.28 contracts                                          | Arc escrow contracts.                                                                          |
| Hardhat                     | 3.18.0                                                    | Contract compilation, deployment, and testing.                                                 |
| OpenZeppelin Contracts      | 5.6.1                                                     | Safe token transfers, reentrancy guard, EIP-712, and signature checking.                       |
| Vitest                      | 5.0.2                                                     | Unit, integration, route, UI, and database testing.                                            |
| Frappe/ERPNext/HRMS         | External deployment; version not fixed by this repository | Employee resource and salary-slip integration. Compatibility must be verified per environment. |
| Docker Compose/Caddy        | Deployment configuration                                  | PostgreSQL, application, scheduler, migration profile, TLS edge, and network isolation.        |
| Arc                         | Testnet chain ID `5042002`                                | Test-USDC settlement and escrow execution.                                                     |

## 9. Data model and API design

### Major entities

```mermaid
erDiagram
    User ||--o{ OrganizationMembership : has
    Organization ||--o{ OrganizationMembership : contains
    OrganizationMembership ||--o{ LendingOffer : creates
    LendingOffer ||--o{ Loan : funds
    OrganizationMembership ||--o{ Loan : borrows_or_lends
    Loan ||--o{ LoanRepaymentPlan : versions
    LoanRepaymentPlan ||--o{ LoanInstallment : schedules
    Loan ||--o{ LoanRepayment : receives
    LoanRepayment ||--o{ RepaymentAllocation : allocates
    LoanInstallment ||--o{ RepaymentAllocation : consumes
    EmployeeDirectoryIntegration ||--o{ EmployeeDirectoryMapping : maps
    EmployeeDirectoryMapping ||--o{ SalaryEvidence : supplies
    LoanInstallment ||--o{ PayrollDeductionProposal : proposes
    LoanInstallment ||--o| DelinquencyCase : may_open
    DelinquencyCase ||--o{ DelinquencyNotification : sends
    User ||--o{ ArcWallet : owns
    Loan ||--o{ AuditEvent : records
    Organization ||--o{ BlockchainEvent : journals
    OrganizationMembership ||--o{ RepaymentAgentMandate : grants
    RepaymentAgentMandate ||--o{ RepaymentAgentRun : governs
```

Important state is deliberately split:

- offer funding status describes whether lender funds were verified in escrow;
- origination decision status describes automated/manual review;
- loan status describes requested, approved, submitted, active, overdue,
  repaid, cancelled, or defaulted application state;
- repayment and transfer statuses distinguish pending/unknown/failed from
  verified completion; and
- the blockchain event journal records finalized observed events separately
  from whether they were safely applied.

### Important API groups

| API group               | Representative endpoints                                                                         | Access                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Authentication          | `/api/auth/sign-in`, `/sign-out`, `/profile`, password reset/change                              | Public for entry/reset; authenticated for profile/change.           |
| Lending policy/capacity | `/api/lending-policy`, `/api/borrowing-capacity`, `/api/employer/lending-policy`                 | Employee read; employer-admin update.                               |
| Offers                  | `/api/lending-offers`, `/mine`, `/[id]/quote`, funding intents/confirm                           | Employee with ownership/organization checks.                        |
| Loans                   | `/api/loans/mine`, `/funded`, `/[id]`, origination decision, acceptance confirmation             | Borrower/lender ownership or employer-admin scope.                  |
| Repayments              | `/api/loans/[id]/repayment-intents`, confirmation and history routes                             | Borrower ownership; verified wallet operation.                      |
| Repayment agent         | `/api/repayment-agent`, mandates, approvals, runs                                                | Borrower for controls; protected internal route for scheduled runs. |
| ERP/payroll             | employer salary-slip and payroll-deduction APIs                                                  | Employer-admin; deduction authorization endpoint is employee-owned. |
| Wallet                  | enrollment/challenge and Arc transfer lifecycle APIs                                             | Authenticated wallet owner.                                         |
| Operations              | `/api/health/live`, `/ready`, protected dependencies, employer loan evidence                     | Public minimal health; sensitive evidence requires authorization.   |
| Internal jobs           | `/api/internal/erpnext-sync`, `/arc-reconciliation`, `/repayment-operations`, `/repayment-agent` | Dedicated bearer secrets; not browser-user APIs.                    |

All identifiers in this guide are examples. Do not publish database IDs,
wallet addresses, transaction hashes, payroll references, or operational URLs
from a real deployment without an approved evidence-redaction process.

## 10. Security and financial safeguards

| Boundary              | Implemented control                                                                                                               | Known limitation                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Authentication        | Scrypt password hashes; random session tokens stored only as SHA-256 hashes; HttpOnly/SameSite cookies; production Secure flag.   | Deployed cookie flags require environment evidence.                                                               |
| Authorization         | Server-side session, role, tenant, owner, and state checks; browser cannot assert organization or role.                           | No separate platform-admin role and no independently verified DB row-level security.                              |
| Browser writes        | Exact-origin checks, Zod validation, PostgreSQL rate limits, safe error envelopes.                                                | Production edge/CSP must be captured after deployment.                                                            |
| ERP data              | Minimal selected fields, URL/redirect safety, encrypted saved credentials, redacted errors, complete-snapshot sync.               | Broader privacy, retention, and access-review controls require organizational approval.                           |
| Wallet custody        | User-controlled Circle Modular Wallet and passkey confirmation.                                                                   | Circle relying-party/origin, callback, and recovery settings are external and not independently verified.         |
| Borrow authorization  | Short-lived EIP-712 signature bound to offer, borrower, expiry, authorization ID, chain, and escrow.                              | An issued signature cannot be revoked during its short validity without contract redesign.                        |
| Repayment agent       | Borrower mandate plus application policy and contract-enforced caps/reserve/window/nonce.                                         | Agent key custody and rotation require managed operational controls.                                              |
| Financial consistency | Integer money, database checks, unique idempotency keys/hashes, locks, conditional transitions, exact receipt/event verification. | Arc records and the legacy internal ledger are separate accounting domains.                                       |
| Reconciliation        | Confirmation delay, replay window, persistent cursor/journal, duplicate event protection, conflict preservation.                  | Audits are bounded and require scaling controls beyond current pilot volume.                                      |
| Audit                 | Immutable decision/review semantics and append-oriented audit/event records.                                                      | No verified database trigger/restricted role makes every audit row tamper-proof against a privileged DB operator. |
| Recovery              | Backup/checksum/isolated restore tools and operational incident records.                                                          | Target-host rollback, PITR, measured RPO/RTO, and full post-restore Arc replay remain unverified.                 |

Never place real secrets in `.env.example`, screenshots, reports, client-visible
`NEXT_PUBLIC_` variables, or source control. Private keys, cron secrets, ERP
credentials, email tokens, and session values are server-only.

## 11. Setup and evaluation instructions

### Prerequisites

- Node.js 20.19 or newer;
- npm 10 or newer;
- Docker Desktop with Docker Compose, or local PostgreSQL;
- Git and a modern browser;
- only for optional integrations: an evaluator-controlled ERPNext/Frappe HR
  instance and/or Circle/Arc Testnet configuration.

### Safe local setup

From the repository root:

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d postgres
npm run prisma:validate
npm run prisma:generate
npm run prisma:deploy
npm run demo:data -- --confirm=local-qastfund-demo
npm run demo:start
```

On macOS/Linux use `cp .env.example .env`. `demo:data` refuses to write unless
the target passes local safety checks and the exact confirmation is supplied.
Never run the development seed against a deployed or production database.

Minimum local placeholders:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/employee_lending?schema=public"
APP_URL="http://localhost:3000"
```

Open `http://localhost:3000/sign-in`. The development-only users are:

| Role             | Email               | Password           |
| ---------------- | ------------------- | ------------------ |
| Employer admin   | `admin@acme.test`   | `AcmeAdmin123!`    |
| Employee Alice   | `alice@acme.test`   | `AcmeEmployee123!` |
| Employee Bob     | `bob@acme.test`     | `AcmeEmployee123!` |
| Employee Charlie | `charlie@acme.test` | `AcmeEmployee123!` |

Verify fixture completeness without changing data:

```powershell
npm run demo:data -- --check
```

Expected minimums are four demo users, three offers, six loans, three repayment
plans, one payroll proposal, and one delinquency case.

### Optional ERPNext connection

Start with [.env.example](../.env.example) and
[ERPNEXT_LOCAL_SETUP.md](./ERPNEXT_LOCAL_SETUP.md). Configure safe placeholders
for the ERPNext base URL, credential encryption, sync enablement/freshness, and
dedicated scheduler secret. Use a least-privilege service account. Do not paste
credentials into this guide or evaluation evidence.

The evaluator should verify:

```powershell
npm run audit:erpnext
npm run verify:erpnext-source
npm run diagnose:erpnext-payroll
```

These commands are environment-dependent. A failed or unavailable service must
be reported, not replaced with a claim based on seeded data.

### Optional Circle/Arc Testnet connection

Required configuration includes Arc chain/RPC/token, the public escrow address,
Circle public client settings, server-side borrow authorizer, reconciliation
settings, and dedicated internal secrets. Use only the values approved for the
testnet environment and follow [ARC_TESTNET_DEPLOYMENT.md](./ARC_TESTNET_DEPLOYMENT.md)
and [BORROW_AUTHORIZATION.md](./BORROW_AUTHORIZATION.md).

Before any transaction:

```powershell
npm run audit:arc
npm run pilot:preflight
```

Proceed only if the preflight explicitly reports ready, the reconciliation
cursor is healthy, both users control their enrolled wallets, the expected V3
escrow is configured, and only test USDC is involved. A local fixture demo is
the default when any gate is not satisfied.

## 12. Testing and verification

Supported commands:

| Command                                                                             | Scope                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run lint`                                                                      | ESLint across application, scripts, and tests.                            |
| `npm run format:check`                                                              | Prettier conformance.                                                     |
| `npm run prisma:validate` / `prisma:status`                                         | Schema validity and applied migrations.                                   |
| `npm test`                                                                          | Isolated Vitest suite using a disposable migrated PostgreSQL database.    |
| `npm run test:contracts`                                                            | Hardhat Solidity tests.                                                   |
| `npm run chain:test`                                                                | Disposable local-chain application lifecycle.                             |
| `npm run typecheck`                                                                 | Hardhat compile, Next route type generation, and TypeScript.              |
| `npm run build`                                                                     | Optimized Next.js production bundle and type check.                       |
| `npm run verify:borrowing` / `verify:repayment` / `verify:ledger` / `verify:policy` | Focused application scenarios.                                            |
| `npm run agent:eval`                                                                | Repayment-agent scenario evaluation.                                      |
| `npm run test:arc-live`                                                             | Opt-in live Circle/Arc checks; requires authorized testnet configuration. |

Latest repository verification recorded by the functional audit:

- application suite: **83 files passed, 1 skipped; 518 tests passed, 1
  skipped**;
- focused requirements changes: **4 files and 62 tests passed**;
- ESLint, Prisma validation, 57-migration replay/status, and
  `git diff --check`: **passed**;
- optimized Next.js bundle compilation: **passed**;
- final build/type check: **failed** on seven existing `unknown`-typing errors
  in `scripts/demo/repayment-agent-demo.ts` and
  `scripts/deploy-lending-escrow.ts`.

The build must therefore not be described as fully passing. Interactive browser
behavior, responsive layouts, real email delivery, current Circle console
settings, current live Arc readiness, and current live ERPNext payroll
compatibility were not verified during this documentation task.

## 13. Known limitations and production readiness

### Implemented but constrained

- Arc settlement is testnet-only and requires environment readiness.
- Each loan has exactly one lender/offer; pooled multi-lender allocation is not
  represented in the schema or contracts.
- Partial repayment is available for V3 loans; legacy escrow loans retain their
  deployed behavior.
- ERP employee sync is read-only. Salary-slip creation produces a calculated
  draft only. Payroll deduction execution remains an authorized external
  employer process followed by reconciliation.
- Notifications cover selected flows, agent messages, and overdue escalation;
  there is no complete decision/funding/upcoming/success/failure catalogue.
- Reports and settings pages are placeholders. Aggregate dashboard and
  loan-level audit data exist, but complete audit/portfolio report export does
  not.

### Production blockers

- no jurisdiction-specific lending, payroll, privacy, consent, retention,
  complaints, or servicing approval;
- no independent Solidity/application penetration and dependency assurance;
- managed signer/agent-key custody and rehearsed immutable-signer rotation are
  incomplete;
- target-host backup/PITR inventory, timed restore, rollback, RPO/RTO, and
  post-restore reconciliation are not demonstrated;
- Circle origin/relying-party/callback/recovery configuration needs external
  evidence;
- no separate platform-administrator RBAC role;
- no independently verified database-level append-only/RLS boundary; and
- known build type errors in two operational scripts remain unresolved.

See [CONTROLLED_PILOT_READINESS.md](./CONTROLLED_PILOT_READINESS.md) for the
release gates. A passing testnet transaction is evidence of one configured
testnet path, not proof of production readiness.

## 14. Evaluator demonstration script

This sequence uses synthetic local data and does not require real money.

### A. Prepare and verify

1. Run the safe local setup from Section 11.
2. Run `npm run demo:data -- --check` and capture the non-sensitive counts.
3. Open `/api/health/live` and `/api/health/ready`; expect healthy local
   process/configuration/database results.

### B. Employer walkthrough

1. Sign in as `admin@acme.test`.
2. Open `/employer` and identify workforce, lending, outstanding-loan, and
   repayment-exception metrics.
3. Open `/employer/employees`; show active/former separation and lending access
   controls. Do not change a record unless the evaluator wants a reversible
   local demonstration.
4. Open `/employer/loans`; inspect requested, approved, active, overdue, and
   repaid examples. Open a loan and identify terms, repayments, and audit events.
5. Open `/employer/monitoring`; show deterministic classifications and the
   human-review boundary.
6. Open `/employer/payroll`; show the synthetic proposal and explain the three
   distinct states: employee authorization, employer review, and externally
   verified reconciliation.
7. Open `/employer/delinquency`; show partial payment, outstanding balance,
   recommended human action, and notification status.
8. Open `/employer/reports` and explicitly identify it as a placeholder.

Evidence to observe: organization scoping, explicit statuses, synthetic money
amounts, installment balances, immutable rationale/audit information, and no
claim that seeded records are live chain transactions.

### C. Employee walkthrough

1. Sign out and sign in as Alice.
2. Open `/app`; identify capacity, current loan obligations, and activity.
3. Open `/app/lending`; show Alice’s lender portfolio and separated available,
   reserved/deployed, repaid, and outstanding amounts.
4. Open `/app/borrow`; choose a synthetic offer and review the amount/term
   controls without submitting a real wallet operation.
5. Open Alice’s active loan from the dashboard. Show the two-installment plan,
   prior allocations, outstanding amount, repayment history, and partial
   repayment control.
6. Open `/app/agent`; explain that the mandate is opt-in and capped. Do not sign
   a mandate unless the environment is an approved testnet exercise.
7. Open wallet setup/send pages and distinguish displayed fixture/application
   state from a live Circle/Arc confirmation.

### D. Decision demonstration

Use the seeded requested/approved examples for a read-only walkthrough, or
create a new local request if the fixture path supports it. Observe:

- amount and repayment term;
- employee and policy gates;
- `REVIEW_REQUIRED` with reason codes and no score;
- employer rationale for approval/rejection; and
- borrower authorization still required after approval.

### E. Repayment and overdue evidence

Use the seeded active and overdue loans to show schedule derivation, partial
allocation, remaining balance, delinquency recommendation, and borrower plus
employer notification records. Do not represent a local/legacy repayment as a
verified Arc transfer unless a matching verified testnet receipt is present.

### F. Optional live testnet segment

Only after `audit:arc` and `pilot:preflight` pass, an authorized evaluator may
fund an offer, approve a borrower request, confirm disbursement, make a small
partial repayment, and inspect the transaction/receipt/journal. Use test USDC,
record transaction hashes only in approved evidence, and stop on any pending,
unknown, conflict, stale-cursor, wrong-contract, or wrong-wallet signal.

## 15. Requirements traceability

| Module/workflow                    | Main requirements          | Audit status summary                                                                                                  |
| ---------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Authentication, tenancy, roles     | FR-37–FR-39                | Authentication/consent pass; RBAC partial because platform Administrator is absent.                                   |
| Employee onboarding and ERP sync   | FR-19, FR-20, FR-23, FR-24 | Employee/status/salary/tenure evidence pass; arbitrary leave/change policy remains partial.                           |
| Lending marketplace and portfolio  | FR-06–FR-11                | Single-lender offer flow passes; multi-lender funding FR-09 fails.                                                    |
| Application, policy, and decision  | FR-01–FR-05, FR-43         | Amount/term, deterministic gates, manual review, and plans pass; exact lifecycle vocabulary is split across entities. |
| Wallet and Arc settlement          | FR-25–FR-31                | Implemented for configured Arc Testnet with verified intents/receipts/reconciliation.                                 |
| Repayment plans and agent          | FR-12–FR-18                | Monitoring, mandate controls, partial repayment, failure handling, overdue notices, and reconciliation pass.          |
| Payroll operations                 | FR-21–FR-24, FR-39         | Evidence/proposals/reconciliation exist; real payroll submission is intentionally external/manual.                    |
| Dashboards, notifications, reports | FR-32–FR-36                | Dashboards pass; notification catalogue and portfolio history are partial; report generation fails.                   |
| Security and compliance            | FR-40–FR-44                | Policy limits pass; immutability, key custody, and data protection are partial; jurisdiction compliance is blocked.   |

For requirement-by-requirement evidence, initial/final status, gaps, and planned
disposition, use [FR_AUDIT_REPORT.md](./FR_AUDIT_REPORT.md). The normative
requirements are in [FR.md](./FR.md).

## 16. Glossary and references

### Glossary

| Term                   | Meaning in QastFund                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Internal lending pool  | Organization-scoped collection of employee-created offers. It is not one pooled treasury in the current data model.                                    |
| Lending offer          | One employee’s stated and, for Arc flows, escrow-funded principal, fee rate, duration, and borrowing bounds.                                           |
| Partial borrowing      | Borrowing less than an offer’s maximum/available amount from one lender. It does not mean multi-lender syndication.                                    |
| USDC                   | A dollar-denominated stablecoin. QastFund’s live blockchain scope uses test USDC on Arc Testnet.                                                       |
| Circle Modular Wallet  | A user-controlled smart account authorized with passkeys through Circle’s SDK.                                                                         |
| Arc                    | Circle’s EVM-compatible blockchain; this project is configured for Arc Testnet chain ID `5042002`.                                                     |
| Salary slip            | Frappe HR/ERPNext payroll document used as bounded income evidence. Only submitted, fresh, currency-consistent evidence is trusted for decision input. |
| Loan decision engine   | Deterministic, versioned rules producing reason codes and `NOT_ELIGIBLE` or `REVIEW_REQUIRED`; it is not a credit-scoring model.                       |
| Repayment agent        | Bounded software that observes obligations and may notify, request approval, or execute within a borrower’s on-chain mandate.                          |
| Idempotency            | Giving an operation a stable unique identity so retries do not create a second financial action.                                                       |
| Reconciliation         | Comparing finalized Arc events/receipts with persisted application intents and applying only verified, non-conflicting results.                        |
| Minor units/base units | Integer cents for application USD values and integer 6-decimal token units for ERC-20 USDC values.                                                     |

### Repository references

- [Technical architecture](./ARCHITECTURE.md)
- [Functional requirements](./FR.md)
- [Requirements audit](./FR_AUDIT_REPORT.md)
- [Loan decision engine](./LOAN_DECISION_ENGINE_V1.md)
- [Loan decision data audit](./LOAN_DECISION_DATA_AUDIT.md)
- [End-to-end origination](./LOAN_ORIGINATION_V1.md)
- [Repayment agent](./REPAYMENT_AGENT.md)
- [ERPNext employee sync](./ERPNEXT_EMPLOYEE_SYNC.md)
- [ERPNext payroll integration](./ERPNEXT_PAYROLL_INTEGRATION.md)
- [Financial invariants and threat model](./FINANCIAL_INVARIANTS_AND_THREAT_MODEL.md)
- [Controlled-pilot readiness](./CONTROLLED_PILOT_READINESS.md)
- [Demonstration runbook](./DEMONSTRATION_RUNBOOK.md)

### External technical references

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Frappe REST API](https://docs.frappe.io/framework/user/en/guides/integration/rest_api)
- [Circle Wallets](https://developers.circle.com/wallets)
- [Circle SDK Arc Testnet definition](https://docs-w3s-node-sdk.circle.com/variables/index.ARC_TESTNET.html)
- [Prisma PostgreSQL connector](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/postgresql)
- [OpenZeppelin Contracts documentation](https://docs.openzeppelin.com/contracts/5.x/)
- [Hardhat documentation](https://hardhat.org/docs)

## Facts requiring human confirmation

The following cannot be established from source code and automated local tests:

1. the intended launch jurisdiction and approved lending, payroll, privacy,
   consent, retention, complaint, and servicing rules;
2. current ERPNext/Frappe/HRMS version compatibility, payroll master data, and
   least-privilege service-account permissions in the evaluator’s environment;
3. current Circle Console relying-party/origin, callback, client-key,
   passkey-recovery, and allowlist settings;
4. current Arc Testnet escrow deployment, wallet ownership/balances,
   reconciliation cursor health, and alert delivery;
5. managed custody, access logging, backup, and rotation/redeployment procedure
   for borrow-authorizer and repayment-agent keys;
6. target-host firewall/network exposure, deployed security headers/cookies,
   backup/PITR retention, restore/rollback evidence, RPO/RTO, and scheduler
   operation; and
7. independent smart-contract/application security assessment and resolution
   of the remaining build/type-check errors.
