# Employee P2P Lending MVP

A production-oriented foundation for an employee peer-to-peer lending application. Local authentication, organization membership, employer reporting, employee dashboards, lending offers, marketplace discovery, Arc Testnet escrow funding and borrowing, full on-chain repayment, loan monitoring, and read-only ERPNext employee synchronization are implemented. Payroll writes and production settlement are intentionally not implemented.

## Prerequisites

- Node.js 20.19 or newer
- npm 10 or newer
- Docker Desktop with Docker Compose, or a local PostgreSQL installation

## Local development quick start

From the repository root:

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d postgres
npm run prisma:validate
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
npm run dev
```

On macOS or Linux, replace the copy command with `cp .env.example .env`.

Wait for PostgreSQL to become healthy before starting the application if the image is being downloaded for the first time. Check its state with:

```bash
docker compose ps
```

Open:

- `http://localhost:3000/` — public landing page
- `http://localhost:3000/sign-in` — sign-in page
- `http://localhost:3000/app` — authenticated employee dashboard
- `http://localhost:3000/app/lending` — create and review personal offers
- `http://localhost:3000/app/borrow` — organization lending marketplace
- `http://localhost:3000/app/borrow/[offerId]` — review and confirm an eligible offer
- `http://localhost:3000/app/loans/[loanId]` — borrower loan details, history, and manual repayment
- `http://localhost:3000/employer` — database-backed employer overview
- `http://localhost:3000/employer/loans` — organization-scoped loan reporting
- `http://localhost:3000/profile` — authenticated profile
- `http://localhost:3000/api/health` — API and database health

Verify the health endpoint from another terminal:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{ "status": "ok", "database": "connected" }
```

## Demo authentication

Run `npm run prisma:seed` to create or refresh the idempotent development organization and accounts:

| Role             | Email               | Password           | Redirect    |
| ---------------- | ------------------- | ------------------ | ----------- |
| `EMPLOYER_ADMIN` | `admin@acme.test`   | `AcmeAdmin123!`    | `/employer` |
| `EMPLOYEE`       | `alice@acme.test`   | `AcmeEmployee123!` | `/app`      |
| `EMPLOYEE`       | `bob@acme.test`     | `AcmeEmployee123!` | `/app`      |
| `EMPLOYEE`       | `charlie@acme.test` | `AcmeEmployee123!` | `/app`      |

The seed also creates employee mock balances, offers, loans, repayments, and
audit events so the employer reporting pages and employee experiences display
representative database-backed data. All seeded employee accounts use the
development-only password `AcmeEmployee123!`.

Authenticated users can view `/profile`, use the existing browser sign-in flow,
or use the JSON authentication endpoints at `/auth/register`, `/auth/login`,
`/auth/logout`, and `/auth/me`. Organization endpoints are available at
`/organization/me` and `/organization/members`; member listing requires the
`EMPLOYER_ADMIN` role.

These credentials are development-only seed data. Do not run the demo seed against a production database.

Stop the application with `Ctrl+C`. Stop PostgreSQL without deleting its local data with:

```bash
docker compose down
```

## Environment configuration

The quick start copies the committed example to the ignored `.env` file. Replace the sample database credentials if needed.

PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Required variables:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/employee_lending?schema=public"
APP_URL="http://localhost:3000"
```

All `.env*` files except `.env.example` are ignored by Git. Server startup validates both required variables with Zod and reports field-level configuration errors without printing secrets.

`APP_URL` must match the browser origin, including its port. Authentication POST routes reject requests from other origins.

Arc borrowing additionally requires a deployed authorization-enabled escrow
and the server-only `ARC_BORROW_AUTHORIZER_PRIVATE_KEY`. See
[`BORROW_AUTHORIZATION.md`](./BORROW_AUTHORIZATION.md) for the trust model,
deployment steps, and incompatibility with offers from the previous contract.

## PostgreSQL setup without Docker

If PostgreSQL is installed directly on the host, start its service and create the database:

```bash
createdb -U postgres employee_lending
```

Alternatively, from `psql`:

```sql
CREATE DATABASE employee_lending;
```

Update `DATABASE_URL` in `.env` to match the PostgreSQL user, password, host, port, and database in your environment. Skip `docker compose up` when using this option. The schema includes authentication, lending offers, loans, internal mock balances, disbursement ledger records, and audit events.

## Prisma commands

```bash
npm run prisma:validate   # validate the Prisma schema and configuration
npm run prisma:generate   # regenerate the typed Prisma Client
npm run prisma:deploy     # apply committed migrations
npm run prisma:seed       # create or refresh local demo accounts
npm run prisma:studio     # inspect the configured database
```

The generated client is written to `src/generated/prisma` and is not intended for manual editing.

## Migrations

After adding a deliberate schema change, create and apply a development migration with:

```bash
npm run prisma:migrate -- --name describe_the_change
```

Commit the generated `prisma/migrations` directory. The existing authentication migration must be applied before seeding demo users.

For deployment environments, apply committed migrations with:

```bash
npm run prisma:deploy
```

The health route executes `SELECT 1` through the repository and Prisma layers. It returns `{"status":"ok","database":"connected"}` only when PostgreSQL is reachable. Failures use the shared API error envelope and do not expose database internals.

## Quality checks

```bash
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm run verify:borrowing # database-backed transactional/idempotency check
npm run verify:repayment # partial/full repayment and ledger integration check
```

Use `npm run test:watch` during active development.

## Project structure

```text
prisma/
  migrations/                    # committed database migrations
  schema.prisma                  # auth, tenancy, and employer reporting records
  seed.ts                        # development-only accounts and reporting data
src/
  app/
    (public)/                    # / and /sign-in
    (authenticated)/profile/     # shared protected profile
    (employee)/app/              # role-protected employee portal
    (employer)/employer/         # role-protected employer portal
    api/auth/                    # sign-in, sign-out, and profile adapters
    api/health/                  # thin health route handler
  generated/prisma/              # generated Prisma Client
  infrastructure/
    config/                       # validated environment access
    database/                     # Prisma client and repositories
    logging/                      # server logging boundary
  integrations/                   # future external-system boundaries
    settlement/
    payroll/
    erp/
  modules/                       # product domains
    auth/                        # authentication use cases and adapters
    organizations/              # employer overview query and repository
    employees/                  # employee dashboard query and future workflows
    lending/                    # offer creation and marketplace queries
    loans/                      # transactional creation, repayment, and loan queries
    ledger/                     # balanced mock disbursement/repayment records
    audit/                      # loan lifecycle event records
  server/
    application/                  # use cases and orchestration
    domain/                       # business concepts and rules
    repositories/                 # data-access contracts
  shared/
    api/ constants/ errors/ types/ utils/ validation/
tests/
```

The backend dependency flow is:

```text
Route/API -> Application service -> Domain/repository contract
                                      -> Infrastructure repository -> Prisma -> PostgreSQL
```

Route handlers translate HTTP concerns, application services orchestrate use cases, domain code holds business rules, repository contracts describe persistence needs, and infrastructure implements those contracts. UI components and route handlers should not query Prisma directly.

When a product module is introduced, prefer a small internal structure such as `domain/`, `application/`, `infrastructure/`, and `schemas/`, adding only the layers that the module actually needs.
