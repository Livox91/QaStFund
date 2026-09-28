# Employee P2P Lending MVP

Production-oriented foundation for an employee peer-to-peer lending application. This repository currently contains infrastructure and placeholder UI routes only; authentication, lending, loans, payroll, settlement, ERP, and blockchain behavior are intentionally not implemented.

## Prerequisites

- Node.js 20.19 or newer
- npm 10 or newer
- PostgreSQL with a database and user available to the application

## Installation

```bash
npm install
```

## Environment setup

Copy the example file and replace the sample database credentials if needed.

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

## PostgreSQL setup

Create an empty local database with PostgreSQL's CLI tools:

```bash
createdb -U postgres employee_lending
```

Alternatively, from `psql`:

```sql
CREATE DATABASE employee_lending;
```

Update `DATABASE_URL` in `.env` to match the PostgreSQL user, password, host, port, and database in your environment. No product tables are defined yet.

## Prisma commands

```bash
npm run prisma:validate   # validate the Prisma schema and configuration
npm run prisma:generate   # regenerate the typed Prisma Client
npm run prisma:studio     # inspect the configured database
```

The generated client is written to `src/generated/prisma` and is not intended for manual editing.

## Migrations

After adding a deliberate schema change, create and apply a development migration with:

```bash
npm run prisma:migrate -- --name describe_the_change
```

Commit the generated `prisma/migrations` directory. The initial foundation has no models and therefore no schema migration.

For deployment environments, apply committed migrations with:

```bash
npx prisma migrate deploy
```

## Development

```bash
npm run dev
```

Open:

- `http://localhost:3000/` — public landing page
- `http://localhost:3000/app` — employee portal placeholder
- `http://localhost:3000/employer` — employer portal placeholder
- `http://localhost:3000/api/health` — application and database health

The health route returns `{"status":"ok","database":"connected"}` when PostgreSQL is reachable. Failures use the shared API error envelope and do not expose database internals.

## Quality checks

```bash
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
```

Use `npm run test:watch` during active development.

## Project structure

```text
prisma/
  schema.prisma                   # minimal PostgreSQL datasource
src/
  app/
    (public)/                     # / and its independent layout
    (employee)/app/               # /app and employee layout
    (employer)/employer/          # /employer and employer layout
    api/health/                   # thin HTTP route handler
  generated/prisma/               # generated Prisma Client
  infrastructure/
    config/                       # validated environment access
    database/                     # Prisma client and repositories
    logging/                      # server logging boundary
  integrations/                   # future external-system boundaries
    settlement/
    payroll/
    erp/
  modules/                        # future product domains
    auth/
    organizations/
    employees/
    lending/
    loans/
    ledger/
    audit/
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
