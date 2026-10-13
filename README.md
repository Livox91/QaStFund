# QastFund

QastFund is an employer-integrated peer-to-peer financing platform for verified
employees. It connects an employer-managed employee directory and conservative
loan review with passkey-controlled Circle wallets and an Arc Testnet escrow.

The current release is approved only for a **two-user, test-fund-only Arc
Testnet validation pilot**. External/public lending, real-money activity, and
production financial operations are not approved.

## Problem and target users

Employees can struggle to demonstrate stable employment and access transparent
short-term financing, while employers lack a controlled way to verify workforce
eligibility without becoming the custodian of employee funds. QastFund targets:

- employees who borrow from or lend to verified colleagues;
- employer administrators who synchronize eligibility and review applications;
- pilot operators who reconcile application records with Arc Testnet events.

QastFund uses ERPNext employee data as an eligibility input, not as an automatic
credit score. The active decision policy fails closed on hard eligibility
violations and sends every otherwise eligible application to an authorized
employer administrator for a permanent, rationale-backed review.

## What is implemented

- Organization-scoped employee and employer portals with server-side session,
  role, tenant, request-origin, validation, and rate-limit controls.
- Read-only ERPNext employee synchronization with bounded pagination, review
  queues, freshness enforcement, invitations, and scheduled health monitoring.
- Versioned deterministic origination rules with no trained model or automatic
  approval; approval and rejection are immutable employer-admin actions.
- Circle Modular Wallet enrollment and passkey-controlled Arc Testnet user
  operations.
- An Arc Testnet escrow for offer funding, authorized borrowing, full repayment,
  receipt confirmation, and finalized-event reconciliation.
- Idempotent transaction intents, duplicate protection, audit events, operational
  health checks, and PostgreSQL backup/restore tooling.

## Architecture

```text
Browser
  ├─ Public site
  ├─ Employee portal
  └─ Employer portal
          │ HTTPS
          ▼
       Caddy
          │ private Docker network
          ▼
  Next.js modular monolith ─────── PostgreSQL
          │      │                    ▲
          │      ├─ ERPNext (read)    │
          │      ├─ Circle wallets    │
          │      └─ Arc Testnet ──────┘ reconciliation journal
          └─ internal scheduler
```

The browser never decides authorization. Route handlers and server-rendered
pages call application services, domain rules, and tenant-scoped repositories.
PostgreSQL holds application state; Arc receipts and finalized events provide
on-chain settlement evidence.

See the [technical architecture](docs/ARCHITECTURE.md) for components, trust
boundaries, lifecycle details, and known limitations.

## Technology

- Next.js 16, React 19, TypeScript, and Tailwind CSS
- PostgreSQL 17, Prisma 7, and Zod
- Solidity, Hardhat, viem, and OpenZeppelin
- Circle Modular Wallets and passkeys
- Arc Testnet and canonical testnet USDC
- ERPNext REST integration
- Docker Compose and Caddy
- Vitest and Hardhat tests

## Local setup

Prerequisites: Node.js 20.19 or newer, npm 10 or newer, and Docker Desktop with
Docker Compose (or a compatible local PostgreSQL installation).

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

On macOS or Linux, replace `Copy-Item .env.example .env` with
`cp .env.example .env`. Open `http://localhost:3000`. The seed credentials and
complete environment reference are in the [developer guide](docs/README.md).
Seed data and credentials are development-only and must never be applied to a
deployed or production database.

Arc and ERPNext features require additional server-side configuration. Start
from `.env.example`; never copy a real credential, private key, session token,
employee record, or wallet recovery material into source control or evidence.

## Verification

The standard local quality sequence is:

```powershell
npm ci
npm run prisma:generate
npm run typecheck
npm run lint
npm run format:check
npm run prisma:validate
npm run prisma:deploy
npm run prisma:status
npm test
npm run test:contracts
npm run build
```

Database commands must target a disposable local/CI database, never the live
deployment. Local-chain validation is available through `npm run chain:test`.
Live-read commands (`npm run audit:arc`, `npm run audit:erpnext`, and
`npm run pilot:preflight`) require an authorized, correctly configured pilot
environment and must not be presented as passed unless their output was
captured successfully.

The frozen results, exact commands, evidence boundaries, and unresolved gates
are recorded in [controlled-pilot readiness](docs/CONTROLLED_PILOT_READINESS.md).

## Demonstration and submission

- Repeatable local startup: `npm run demo:start`
- Read-only fixture check: `npm run demo:data -- --check`
- Explicit local fixture preparation:
  `npm run demo:data -- --confirm=local-qastfund-demo`
- [5–7 minute submission demo](submission/DEMO_SCRIPT.md)
- [Presentation](submission/PRESENTATION.md)
- [Feature status and evidence](submission/FEATURE_STATUS.md)
- [Genuine screenshot capture checklist](submission/screenshots/README.md)
- [Demonstration runbook](docs/DEMONSTRATION_RUNBOOK.md)
- [Submission summary](docs/SUBMISSION_SUMMARY.md)
- [Controlled-pilot readiness and evidence index](docs/CONTROLLED_PILOT_READINESS.md#submission-evidence-index)
- [Arc Testnet pilot report](docs/ARC_TESTNET_PILOT_REPORT.md)
- [End-to-end loan origination](docs/LOAN_ORIGINATION_V1.md)
- [Database recovery](docs/DATABASE_BACKUP_AND_DISASTER_RECOVERY.md)

## Release limitations

The technical GO is not a security certification, regulatory approval, or
authorization for public or real-money lending. Before any broader release,
QastFund still requires managed signer custody and rotation planning,
target-host backup/restore and rollback verification, Circle origin/callback
assurance, independent security review, and applicable legal and privacy
approval. The complete gate matrix is maintained in the readiness document.
