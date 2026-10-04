# Database backup and disaster recovery

## Recovery answer

If PostgreSQL disappears, stop application and worker writes, provision a new PostgreSQL 17 database, restore the newest verified backup, apply any migrations released after that backup, and point the application at the restored database. Then run Arc reconciliation from the restored cursor. If the cursor is absent or untrusted, reset it to the escrow deployment block and replay. Reconciliation is idempotent, so rescanning already-seen events is safe.

A backup is mandatory. Arc events can recover finalized escrow transitions, but they cannot recreate users, organizations, memberships, policies, Circle wallet ownership bindings, ERPNext mappings, or every internal intent-to-tenant relationship.

## Production backup strategy

Use PostgreSQL-native facilities supplied by the database provider; do not run backups inside the Next.js process.

1. Enable encrypted continuous WAL archiving and point-in-time recovery when the provider supports it. Target an RPO of 15 minutes or better.
2. Retain provider snapshots for at least 35 days and one monthly snapshot for 12 months. Keep snapshots in a separate failure domain or provider backup account when available.
3. Produce a nightly portable custom-format logical backup with `npm run db:backup`. Do not overlap it with schema deployments. Retain at least 35 daily copies. The logical-backup fallback RPO is therefore 24 hours.
4. Encrypt backup objects at rest with a managed key, require TLS in transit, restrict restore access separately from application access, and enable immutable/versioned retention where available.
5. Record the checksum, PostgreSQL major version, application revision, Prisma migration status, creation time, and retention expiry alongside each backup. Never record a database URL, password, token, or provider credential.
6. Run `npm run dr:verify` against an isolated PostgreSQL server after migration changes and at least quarterly in the production operations environment. Set and measure an RTO; the initial planning target is four hours, but it is not validated until a timed production-like exercise is completed.

The application database contains password hashes, session-token hashes, financial records, and personal data. Treat every backup as highly sensitive even though raw passwords, Circle secrets, ERPNext credentials, wallet recovery secrets, private keys, and authorization signatures are not stored in PostgreSQL.

## Creating a logical backup

Requirements: PostgreSQL 17-compatible `pg_dump` and `pg_restore` on `PATH`. Supply secrets through the process environment or a secret manager, never command-line arguments.

```powershell
$env:DATABASE_URL = '<loaded from the deployment secret manager>'
$env:BACKUP_FILE = 'D:\secure-backups\employee-lending-2026-10-04.dump'
npm run db:backup
```

The command creates a compressed custom-format dump, validates its table of contents, and writes a SHA-256 file beside it. Its logs omit connection details. Copy both files to encrypted backup storage.

## Restoring a backup

Restore into a newly provisioned database whenever possible. The restore command deliberately clears the target `public` schema and refuses to run unless the operator confirms the exact target database name.

```powershell
$env:BACKUP_FILE = 'D:\secure-backups\employee-lending-2026-10-04.dump'
$env:RESTORE_DATABASE_URL = '<loaded from the recovery secret manager>'
$env:RESTORE_CONFIRM_DATABASE = 'employee_lending_recovery'
npm run db:restore

$env:DATABASE_URL = $env:RESTORE_DATABASE_URL
npm run prisma:status
npm run prisma:deploy
npm run typecheck
npm test
```

Run `prisma:deploy` after restore only to apply migrations newer than the backup. Never use `prisma migrate reset` on a recovery database.

## Automated disposable restore verification

`npm run dr:verify` requires an administrative PostgreSQL URL whose role can create and drop databases. It creates uniquely named `dr_*_source` and `dr_*_restore` databases, and never modifies the database named in the administrative URL.

```powershell
$env:DATABASE_ADMIN_URL = '<loaded from the test secret manager>'
npm run dr:verify
```

The verifier performs these checks:

1. Creates an empty source database and applies every Prisma migration.
2. Confirms migration status and inserts a non-sensitive reconciliation cursor fixture.
3. Creates and checksum-validates a custom-format backup.
4. Restores into a different empty disposable database.
5. Confirms the restored Prisma migration history and exact cursor values.
6. Runs the restored-cursor and database reconciliation tests against the restored database.
7. Proves a restored cursor resumes at its saved block and that applying a duplicate finalized event does not create duplicate loans, repayments, or audit records.
8. Drops both disposable databases unless `KEEP_DR_DATABASES=true`.

The CI workflow runs this verifier using its isolated PostgreSQL service.

## Authority and recoverability

| State                                                                               | Authority after an incident    | Recovery behavior                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Users, organizations, memberships, password hashes, sessions                        | PostgreSQL backup              | Not present on Arc; restore from backup. Revoke sessions after a suspected compromise.                                                           |
| Lending policies, employment status, decision evaluations/reviews, employer actions | PostgreSQL backup              | Not recoverable from Arc.                                                                                                                        |
| Circle wallet ownership bindings and enrollment state                               | PostgreSQL backup plus Circle  | Arc addresses are visible, but internal user ownership cannot be inferred safely. Re-verify with Circle if inconsistent.                         |
| ERPNext configuration references, mappings, and sync history                        | PostgreSQL backup plus ERPNext | Directory data can be read again, but historical mappings and review decisions require the backup. Credentials remain in the secret manager.     |
| Funding/acceptance/repayment intents and tenant associations                        | PostgreSQL backup              | Required to match Arc events to internal organizations and records. Missing intents leave events unmatched.                                      |
| Finalized escrow offer, loan, and repayment facts                                   | Arc chain                      | `OfferCreated`, `LoanStarted`, and `LoanRepaid` can confirm or recover database transitions after the corresponding intent records are restored. |
| Blockchain event journal and reconciliation cursor                                  | Rebuildable from Arc           | Restore for speed; otherwise replay from the escrow deployment block.                                                                            |
| Ledger and non-chain audit history                                                  | PostgreSQL backup              | Do not infer these from token transfers alone. Reconciliation only recreates the audit records explicitly implemented for matched escrow events. |

## Replaying Arc after restore

1. Keep user traffic and transaction submission disabled.
2. Confirm `ARC_CHAIN_ID`, the escrow contract address, RPC URL, confirmation depth, and `ARC_RECONCILIATION_START_BLOCK`. The start block must be the escrow deployment block, not the current head.
3. Inspect `/api/health/dependencies` and the restored `BlockchainReconciliationCursor`.
4. If the cursor is trustworthy, run bounded reconciliation passes until the cursor catches the finalized chain head:

   ```powershell
   npm run reconcile:arc
   ```

5. If the cursor is missing, the worker creates it from `ARC_RECONCILIATION_START_BLOCK` automatically.
6. If the cursor is corrupt or incorrectly ahead, preserve a forensic copy, then delete only that contract's cursor. Do not delete the blockchain event journal:

   ```sql
   DELETE FROM "BlockchainReconciliationCursor"
   WHERE "chainId" = 5042002
     AND "contractAddress" = '<lowercase escrow address>';
   ```

7. Run bounded reconciliation repeatedly. Its reorg window and unique `(chainId, contractAddress, transactionHash, logIndex)` key make replay safe. Applied events return `ALREADY_APPLIED`; finalized conflicts are flagged rather than silently reversing financial state.
8. Investigate every `UNMATCHED` or `CONFLICT` event before reopening writes. An event created after the selected backup may have no recoverable internal intent and therefore requires operator investigation; do not invent tenant ownership from chain addresses.
9. Compare pending offers, requested loans, pending repayments, unmatched/conflicting events, and the latest reconciled block with Arc before restoring traffic.

## Incident runbook

### Database corruption

1. Disable writes and reconciliation; preserve logs and a storage snapshot.
2. Confirm corruption on a clone when possible.
3. Restore the latest known-good backup into a new database.
4. Validate migrations and application tests, replay Arc, investigate differences, then switch `DATABASE_URL`.

### Accidental deletion

1. Stop writes immediately to bound further damage.
2. Prefer point-in-time recovery to a moment before deletion.
3. Restore to a separate database, validate tenant and financial row counts, replay Arc from the restored cursor, and cut over.

### Failed migration

1. Stop the rollout and use the last compatible application version.
2. Do not edit `_prisma_migrations` or run `migrate reset`.
3. For a non-destructive failure, ship a forward corrective migration.
4. For destructive corruption, restore the pre-migration backup into a new database, deploy the compatible application, then prepare and test a forward migration.

### Application outage

1. Check liveness, readiness, dependency health, deployment logs, PostgreSQL health, and Arc RPC health.
2. If the database is intact, restart or roll back the application without restoring data.
3. Confirm workers resume and no stale reconciliation alert remains before reopening traffic.

### Lost reconciliation state

1. Preserve the current event journal and cursor for investigation.
2. Reset only the affected cursor as described above.
3. Replay from the deployment block and investigate unmatched/conflicting events. Do not move funds or alter the contract.

### Backup restore and blockchain replay

Follow the restore and Arc replay sections in order. Restore database identity and intent state first; Arc reconciliation is a repair step after restore, not a substitute for the backup.

## Verification record

Repository-level validation commands and their outcomes must be recorded in the milestone report. A restore is considered proven only when `npm run dr:verify` completes against real PostgreSQL. Syntax checks or mocked databases do not count as restore proof.

### 2026-10-04 local execution

The following checks were actually run in the repository workspace:

- `node --check scripts/database/postgres-tools.mjs` and the three entry scripts: passed.
- `npm test -- --run tests/database-recovery-tools.test.mjs tests/disaster-recovery-database.test.ts tests/blockchain-reconciliation.test.ts`: 14 passed; the real restored-database test was skipped because verification mode was not enabled.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run prisma:validate`, and `npm run build`: passed.
- `node --env-file=.env scripts/database/verify-disaster-recovery.mjs`: stopped safely at `verify psql availability could not start (ENOENT)` because this workstation has no PostgreSQL client tools. Docker's service was also unavailable and could not be started without elevated permissions.

No local backup restore was completed on this date, so this execution is **not** restore proof. The first successful CI or operator execution of `npm run dr:verify` must be appended here with its application revision, PostgreSQL version, duration, and output summary.
