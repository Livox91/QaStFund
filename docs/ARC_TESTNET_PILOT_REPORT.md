# Arc Testnet pilot report

Date: 2026-10-04  
Repository revision: `3358f1c7110101b79dd1b2b408e4fd9aef0b61cf`  
Pilot result: **BLOCKED AT PREFLIGHT — NOT READY FOR A CONTROLLED EMPLOYER PILOT**

No Arc transaction, contract deployment, wallet enrollment, or test-fund
movement was attempted. Required Arc configuration was absent, so stopping at
preflight was the only safe result.

## Preflight

| Check                        | Evidence                                                                                                                                                                                                                            | Result           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| CI                           | GitHub Actions run `37195239253` succeeded for the repository revision above. The current working-tree changes also passed the local CI-equivalent application, contract, lint, typecheck, format, migration, DR, and build checks. | PASS             |
| Migrations                   | PostgreSQL reports all 30 committed migrations applied. A fresh disposable database was also rebuilt from all 30 migrations.                                                                                                        | PASS             |
| Authorized escrow deployed   | No configured escrow address and no deployment record available to inspect.                                                                                                                                                         | BLOCKED          |
| Application contract address | `NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS` is missing.                                                                                                                                                                              | BLOCKED          |
| Authorizer consistency       | `ARC_BORROW_AUTHORIZER_PRIVATE_KEY` and the deployment-only public authorizer address are missing, so the configured signer cannot be compared with `authorizationSigner()` on-chain.                                               | BLOCKED          |
| Arc RPC                      | Public RPC returned chain ID `0x4cef52` (5042002).                                                                                                                                                                                  | PASS             |
| USDC                         | The canonical testnet USDC address has deployed bytecode on the public Arc RPC, but `ARC_USDC_ADDRESS` is absent from the runtime configuration.                                                                                    | BLOCKED          |
| Circle                       | A public Circle client key and client URL are present. Wallet enrollment could not be validated without the rest of the Arc configuration and separate pilot accounts.                                                              | BLOCKED          |
| Reconciliation               | Dependency health reports reconciliation disabled; contract address, start block, cron secret, and enabled flag are absent.                                                                                                         | BLOCKED          |
| ERPNext                      | Dependency health reports ERPNext disabled. It is disabled by the application default rather than an explicit local `false` value.                                                                                                  | PASS WITH ACTION |
| Rate limiting                | Runtime default is enabled. A dedicated disposable account probe returned `303,303,303,303,303,429`; the sixth attempt was limited. The log contained only a truncated identity fingerprint.                                        | PASS             |
| Health/monitoring            | Liveness was `alive`; readiness reported healthy configuration and database; dependency health correctly reported degraded Arc, healthy configured Circle, disabled ERPNext, and disabled reconciliation.                           | PASS             |
| Backup/restore               | PostgreSQL 17.11 created and checksum-validated a 123,775-byte backup, restored it into a disposable database, verified the cursor, and passed cursor-resume and duplicate-event reconciliation tests.                              | PASS             |

For a controlled deployment, configure a dedicated
`RATE_LIMIT_HASH_SECRET` instead of relying on the documented database-URL
fallback. Set `ERP_NEXT_SYNC_ENABLED=false` explicitly if ERPNext is not part of
the pilot.

## Test organization

Test users created: **0**.

The realistic organization was not created because contract, wallet, and
reconciliation prerequisites failed. Creating identities before the intended
chain deployment is known would leave misleading pilot data and would not prove
the requested lifecycle.

## Lifecycle results

| Scenario                           | Expected      | Actual                                | Result  | Transaction |
| ---------------------------------- | ------------- | ------------------------------------- | ------- | ----------- |
| Employer setup and employee import | Configured    | Not run; preflight blocked            | BLOCKED | —           |
| Wallet enrollment                  | Ready         | Not run; Arc configuration incomplete | BLOCKED | —           |
| Offer creation/funding             | Confirmed     | Not submitted                         | BLOCKED | —           |
| Offer acceptance                   | Confirmed     | Not submitted                         | BLOCKED | —           |
| Loan activation                    | Reconciled    | Not submitted                         | BLOCKED | —           |
| Repayment                          | Confirmed     | Not submitted                         | BLOCKED | —           |
| Ledger/balance verification        | Matches chain | No real lifecycle to compare          | BLOCKED | —           |

## Failure and recovery results

| Scenario                              | Expected                       | Actual                                                                   | Result  | Transaction |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------------ | ------- | ----------- |
| Interrupted confirmation              | Recovered                      | Automated behavior passes; real testnet scenario not run                 | BLOCKED | —           |
| API timeout after submission          | Recovered                      | Real testnet scenario not run                                            | BLOCKED | —           |
| RPC unavailable                       | Remains pending, then recovers | Automated retry behavior passes; real testnet scenario not run           | BLOCKED | —           |
| Duplicate request                     | Prevented                      | Automated application and contract tests pass; no testnet transaction    | BLOCKED | —           |
| Duplicate confirmation/event          | Idempotent                     | Restored-database reconciliation proof passed; no testnet event          | BLOCKED | —           |
| Worker restart/delayed reconciliation | Recovered                      | Worker is not configured, so the real scenario cannot run                | BLOCKED | —           |
| Reverted transaction                  | Not marked successful          | Automated receipt tests pass; no testnet transaction                     | BLOCKED | —           |
| Wallet failure                        | Recoverable/error visible      | Automated wallet tests pass; no real Circle wallet                       | BLOCKED | —           |
| Insufficient USDC                     | Rejected                       | Contract tests pass; no funded testnet wallet                            | BLOCKED | —           |
| Unauthorized borrower                 | Rejected                       | Automated application and contract tests pass; no testnet transaction    | BLOCKED | —           |
| Cross-organization access             | Rejected                       | Database-backed authorization tests pass; no pilot organizations created | BLOCKED | —           |

Automated evidence is deliberately not reported as a successful end-to-end
testnet scenario.

## Financial invariants and reconciliation

Application, database, and contract tests currently cover duplicate loans,
duplicate repayments, authorization replay, wrong borrowers, double acceptance,
repayment limits, tenant isolation, receipt finality, finalized-record conflict
handling, and duplicate event processing. The disaster-recovery run additionally
proved restored-cursor resume and financial idempotency.

The milestone requires those invariants to be observed against real Arc
transactions. That evidence does not exist yet. There are no transaction hashes
to report, no authoritative-chain/database comparison was possible, and the
stop/restart reconciliation exercise was not attempted because reconciliation
is disabled.

## Bugs and inconsistencies

- Bugs fixed during this pilot: **none**; execution stopped before the lifecycle.
- Database inconsistencies found against Arc: **not assessed** because there was
  no configured contract or pilot transaction.
- Local dependency health reports two pre-existing pending transaction records.
  They were not modified and must not be treated as pilot evidence.

## Required actions before rerun

1. Provide the intended Arc Testnet escrow address and deployment block.
2. Provide the dedicated server-side borrow-authorizer key through the local
   secret mechanism and confirm its public address matches the contract's
   `authorizationSigner()` value.
3. Configure Arc chain ID, RPC URL, canonical USDC address, and application
   contract address.
4. Enable reconciliation with the deployment start block and a cron secret, then
   verify dependency health is healthy rather than disabled.
5. Validate the Circle client configuration by enrolling separate pilot wallets.
6. Explicitly disable ERPNext or supply pilot-safe read-only credentials.
7. Configure a dedicated rate-limit hashing secret.
8. Rerun preflight, then create isolated pilot identities and fund only their
   testnet wallets with test USDC.

Until these actions are complete, the system is **not ready for a controlled
employer pilot**.

## Commands executed

```powershell
gh run list --limit 5
gh run view 37195239253 --json conclusion,headSha,name,createdAt,updatedAt,url
docker compose ps
npm run prisma:status
$env:POSTGRES_TOOLS_DOCKER_SERVICE = 'postgres'
npm run dr:verify
npm start
# GET /api/health/live, /api/health/ready, /api/health/dependencies
# Six invalid sign-in probes against one disposable account identifier
# Public Arc JSON-RPC: eth_chainId, eth_blockNumber, eth_getCode for testnet USDC
```

Database and RPC credentials, private keys, Circle keys, passwords, and complete
rate-limit identities were not printed or written to this report.
