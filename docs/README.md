# Employee P2P Lending MVP

A production-oriented foundation for an employee peer-to-peer lending application. Basic local authentication and organization membership are implemented; lending, loans, payroll, settlement, ERP, and blockchain behavior are intentionally not implemented.

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
- `http://localhost:3000/app` — employee portal placeholder
- `http://localhost:3000/employer` — employer portal placeholder
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

| Role             | Email                | Password       | Redirect    |
| ---------------- | -------------------- | -------------- | ----------- |
| `EMPLOYER_ADMIN` | `admin@demo.test`    | `Employer123!` | `/employer` |
| `EMPLOYEE`       | `employee@demo.test` | `Employee123!` | `/app`      |

Authenticated users can view `/profile` or `GET /api/auth/profile` and sign out from either dashboard.

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

## PostgreSQL setup without Docker

If PostgreSQL is installed directly on the host, start its service and create the database:

```bash
createdb -U postgres employee_lending
```

Alternatively, from `psql`:

```sql
CREATE DATABASE employee_lending;
```

Update `DATABASE_URL` in `.env` to match the PostgreSQL user, password, host, port, and database in your environment. Skip `docker compose up` when using this option. Only foundational authentication tables are defined; no lending product schema exists yet.

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
```

Use `npm run test:watch` during active development.

## Project structure

```text
prisma/
  migrations/                    # committed database migrations
  schema.prisma                  # foundational auth/organization schema
  seed.ts                        # development-only demo accounts
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
