# MVP Architecture

Status: Proposed architecture for the modular-monolith MVP. This document defines boundaries; it does not imply that the product modules or integrations are implemented.

## 1. Architectural shape

Deploy one Next.js application and one PostgreSQL database:

```text
Public site ───────┐
Employee portal ──┼─> Next.js entry points ─> application modules ─> PostgreSQL
Employer portal ──┘              │                       │
                                 └──────── integration ports ─> external adapters
```

Next.js serves the three web experiences, Route Handlers, and server-side application code. PostgreSQL is the system of record. The MVP does not require microservices, Redis, queues, or a separate API deployment.

Module boundaries are enforced in code and data ownership even though all modules run in one process. This keeps deployment simple while allowing a module to be extracted later if scale or team ownership justifies it.

## 2. Application boundaries

### User-facing applications

- **Public site (`/`)**: product education, company lead capture, and future onboarding entry points. It must not depend on authenticated portal layouts.
- **Employee portal (`/app`)**: employee-only workflows within one active organization.
- **Employer portal (`/employer`)**: organization administration for authorized HR, finance, and administrator users.
- **Backend/API (`/api`)**: HTTP entry points, authentication callbacks, and future webhooks. Handlers validate and translate HTTP input, invoke application use cases, and translate results to responses. They contain no material business logic or direct Prisma queries.

The browser is never a security boundary. Server Components, Server Actions, and Route Handlers must all invoke the same authenticated application services and authorization policies.

### Backend dependency rule

```text
UI / Route Handler
        ↓
Application use case
        ↓
Domain rules + repository/integration interfaces
        ↓
Infrastructure adapters (Prisma, auth provider, external systems)
```

Dependencies point inward. Domain code does not import Next.js, Prisma, or provider SDKs. Cross-module behavior goes through a module's public application interface rather than another module's repository or internal domain objects.

## 3. Major backend modules

Each module may contain `domain/`, `application/`, `infrastructure/`, and `schemas/`; only add a layer when it is needed.

| Module          | Owns                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`          | Local user identity, external identity links, sessions/authentication adapter, and actor resolution.                                      |
| `organizations` | Tenant lifecycle, memberships, employer roles, organization status, and organization-level settings.                                      |
| `employees`     | Organization-scoped employee profiles, verification state, and employment status.                                                         |
| `lending`       | Lending policies, lender offers, marketplace availability, and deterministic offer eligibility rules.                                     |
| `loans`         | Loan lifecycle, terms snapshot, repayment schedule, repayment commands, and loan status transitions.                                      |
| `ledger`        | Immutable accounts, transactions, and balanced entries when financial movement is introduced. Derived balances are never edited directly. |
| `audit`         | Append-only records of security-sensitive, administrative, and financial actions.                                                         |

`integrations` contains adapters, not product policy. Reporting begins as read queries owned by the relevant module; it should not become a separate write model in the MVP.

System-level concerns such as health checks, configuration, logging, API responses, and the Prisma client remain under `infrastructure`, `server`, and `shared`. New product behavior belongs under `modules`, so the generic `server` directories do not become a catch-all.

## 4. Frontend structure

Keep route entry points small and organize them by audience:

```text
src/app/
  (public)/                 # public layout and pages
  (employee)/app/           # employee layout and pages
  (employer)/employer/      # employer layout and pages
  api/                      # HTTP/auth/webhook adapters
src/modules/<module>/
  ui/                       # module-specific components when needed
  application/
  domain/
  infrastructure/
  schemas/
src/shared/
  ui/                       # genuinely reusable primitives only
```

Pages compose module UI and load data through server-side application use cases. Client Components are used only for browser interaction. Zod schemas may be shared between forms and HTTP boundaries, but database records are not passed directly to the UI; use explicit view models.

The public, employee, and employer route groups retain separate layouts so their navigation, branding, loading states, and error boundaries can evolve independently.

## 5. Authentication

The initial MVP uses local email/password credentials behind an adapter owned by `auth`. Passwords are stored only as memory-hard scrypt hashes. Sessions are opaque random tokens: the browser receives the raw token in a secure cookie while PostgreSQL stores only its SHA-256 hash. This keeps session revocation server-side and avoids placing roles or personal data in browser-readable state.

A future managed OpenID Connect provider will be introduced as another auth adapter. Provider-specific identity must remain outside domain and application code so SSO can replace credential verification without changing organization memberships or authorization policies.

Authentication flow:

1. The server validates submitted credentials and verifies the password hash.
2. It resolves one active `OrganizationMembership` and creates an organization-scoped database session.
3. It establishes an `HttpOnly`, `Secure` in production, `SameSite=Lax` session cookie.
4. Every protected data access resolves the session and membership from PostgreSQL. Cookie presence alone is only an optimistic routing check.

Sessions are resolved server-side on every protected request. Do not store authorization state in browser-readable tokens. Login, logout, session rotation, and request-origin protection remain within the auth boundary. Registration, password reset, SSO, MFA, invitations, and multi-organization selection are deferred explicitly.

## 6. Authorization and tenancy

`OrganizationMembership` is the tenant access boundary between a user and an organization. A user may belong to more than one organization, but each request operates against one explicitly resolved active organization.

Initial roles should remain small:

- `EMPLOYEE`
- `EMPLOYER_ADMIN`
- `PLATFORM_ADMIN` for tightly controlled platform operations, not normal tenant access

Add HR/finance capabilities only when workflows require distinct permissions. Authorization policies should evaluate an `Actor` containing `userId`, `organizationId`, membership status, and roles. Application use cases perform the policy check before reading or mutating tenant data.

Rules:

- Never trust an `organizationId`, employee ID, or role supplied by the browser.
- Resolve the active organization from the authenticated membership, then verify any route-scoped organization against it.
- Use the shared authorization policies for authentication, role checks, and organization access. A cross-organization request returns the same generic `404 ORGANIZATION_NOT_FOUND` response whether or not the foreign organization exists.
- Repository methods for tenant-owned data require `organizationId`; unscoped methods are reserved for explicit platform administration.
- Check resource ownership and current status in addition to role. For example, an employee role alone does not authorize access to another employee's loan.
- Employer actions and financial state transitions create audit events.
- Hiding UI controls improves usability but never replaces server-side authorization.

PostgreSQL row-level security is not required for the first MVP. Application enforcement plus tenant-safe constraints is simpler initially; RLS can be added later as defense in depth without changing the domain contracts.

## 7. Database ownership and financial data

Use one PostgreSQL database, one Prisma schema, and one migration history. Tables have one logical owner:

| Owner                | Likely records                                                 |
| -------------------- | -------------------------------------------------------------- |
| `auth`               | users, external identities, sessions if locally persisted      |
| `organizations`      | organizations, memberships, organization settings              |
| `employees`          | employee profiles and verification/employment state            |
| `lending`            | policies and lending offers                                    |
| `loans`              | loans, term snapshots, repayment schedule items, repayments    |
| `ledger`             | accounts, transactions, entries                                |
| `audit`              | append-only audit events                                       |
| integration adapters | integration connections, external references, webhook receipts |

Only the owning module mutates its tables. A cross-module workflow is coordinated by an application use case and, when atomicity is required, one database transaction. Read-oriented joins are allowed through explicit query services, but they must not bypass ownership for writes.

Every tenant-owned row includes `organizationId`. Use composite uniqueness and, where practical, composite foreign keys containing `organizationId` so the database cannot link records across tenants. Use stable opaque IDs and timestamps. Financial and audit records use status transitions or reversal records rather than destructive updates or deletion.

Money is never represented with floating point. Store fiat amounts as integer minor units plus currency and token amounts as integer base units plus asset/scale. Store rates as integers with an explicit scale (for example basis points), snapshot agreed terms on the loan, and define deterministic rounding rules in tested domain functions.

When ledger functionality is introduced, balances are derived from immutable, balanced ledger entries. A provider transfer ID is an external reference, not the internal source of financial truth.

## 8. External integration boundaries

Core modules depend on narrow interfaces; provider adapters depend on SDKs and external payloads:

- `SettlementProvider`: future wallet/address, transfer, transfer-status, and webhook operations. A mock implementation is used until Circle/Arc work is explicitly requested.
- `PayrollProvider`: employee/payroll data import and future repayment instruction capabilities. Provider-specific fields are translated to internal DTOs.
- `ErpProvider`: future organization/accounting export or synchronization operations.
- `IdentityProvider`: OIDC login, callback validation, and logout integration for authentication.

Provider credentials and external IDs never enter domain entities unless represented as opaque references. Webhook routes verify signatures, persist an idempotency key/webhook receipt, and then invoke an application command. Retries must be safe. When real asynchronous money movement is introduced, add a transactional outbox and worker deliberately; do not add queue infrastructure before that need exists.

## 9. API, errors, and validation

- Validate all external input with Zod at the entry boundary.
- Use explicit command/query DTOs rather than Prisma-generated types as API contracts.
- Return the shared error envelope with stable codes and safe messages.
- Log internal context server-side without exposing stack traces, SQL errors, provider responses, or secrets.
- Require idempotency keys for future commands that can create loans, repayments, ledger transactions, or external transfers.

## 10. Testing and evolution

- Unit-test domain rules and monetary calculations without Next.js or PostgreSQL.
- Test application use cases with in-memory/mock repository and integration interfaces.
- Add PostgreSQL integration tests for repository scoping, constraints, and transactions.
- Add route contract tests for authentication, authorization, validation, and error shapes.
- Add end-to-end tests only for critical cross-boundary user journeys.

This architecture scales first by adding application instances and database capacity. Modules can later publish events through an outbox, gain separate workers, or be extracted behind their existing interfaces. Those changes are evolutionary options, not MVP prerequisites.
