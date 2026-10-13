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
$env:BACKUP_FILE = 'D:\secure-backups\qastfund-2026-10-04.dump'
npm run db:backup
```

The command creates a compressed custom-format dump, validates its table of contents, and writes a SHA-256 file beside it. Its logs omit connection details. Copy both files to encrypted backup storage.

## Restoring a backup

Restore into a newly provisioned database whenever possible. The restore command deliberately clears the target `public` schema and refuses to run unless the operator confirms the exact target database name.

```powershell
$env:BACKUP_FILE = 'D:\secure-backups\qastfund-2026-10-04.dump'
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

For local development without native PostgreSQL client binaries, the verifier can use the existing Compose service's PostgreSQL 17 tools:

```powershell
docker compose up -d postgres
$env:POSTGRES_TOOLS_DOCKER_SERVICE = 'postgres'
$env:DATABASE_ADMIN_URL = '<loaded from the test secret manager>'
npm run dr:verify
```

Set `DR_ARTIFACT_DIRECTORY` to a new, protected directory when the verified
fixture backup and checksum must be retained as evidence. The backup command
refuses to overwrite an existing dump or checksum.

Only environment variable names—not their values—are passed in Docker command arguments.

The verifier performs these checks:

1. Creates an empty source database and applies every Prisma migration.
2. Confirms migration status and inserts non-sensitive organization, user, membership, and reconciliation-cursor fixtures.
3. Creates and checksum-validates a custom-format backup.
4. Proves corrupt, missing-checksum, interrupted-transfer, and unavailable-dependency failures do not clear the target database.
5. Restores into a different empty disposable database and records restore and total elapsed time.
6. Confirms the restored Prisma migration history, essential identity fixtures, and exact cursor values.
7. Runs the restored-cursor and database reconciliation tests against the restored database.
8. Proves a restored cursor resumes at its saved block and that applying a duplicate finalized event does not create duplicate loans, repayments, or audit records.
9. Drops both disposable databases unless `KEEP_DR_DATABASES=true`.

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
3. Inspect the restored `BlockchainReconciliationCursor` and use an
   authenticated `GET /api/health/dependencies` with
   `OPERATIONAL_HEALTH_SECRET`. This health request is read-only.
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

The supported deployment preserves the previously deployed application and
scheduler as `qastfund-app:rollback` and
`qastfund-reconciliation-scheduler:rollback`. After confirming that the
previous application is compatible with the current database schema, roll back
on the target host with:

```sh
cd "$HOME/QaStFund"
docker tag qastfund-app:rollback qastfund-app:current
docker tag qastfund-reconciliation-scheduler:rollback qastfund-reconciliation-scheduler:current
docker compose -f compose.production.yaml --env-file deploy/.env.production up -d --no-build app reconciliation-scheduler
docker compose -f compose.production.yaml --env-file deploy/.env.production images
```

The PostgreSQL and Caddy base images currently use major-version tags rather
than immutable digests. Record the image IDs printed by each deployment before
relying on them for a rollback decision.

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
- Initial `node --env-file=.env scripts/database/verify-disaster-recovery.mjs`: stopped safely at `verify psql availability could not start (ENOENT)` because this workstation had no native PostgreSQL client tools.
- After Docker became available, the final proof was run with the existing Compose PostgreSQL service:

  ```powershell
  docker compose up -d postgres
  $env:POSTGRES_TOOLS_DOCKER_SERVICE = 'postgres'
  node --env-file=.env scripts/database/verify-disaster-recovery.mjs
  ```

The final proof passed against PostgreSQL 17.11 in 86.7 seconds. It applied all 28 migrations to an empty source database, confirmed migration status, created and checksum-validated a 123,453-byte custom-format backup, restored it into a separate disposable database, verified the exact reconciliation cursor, and ran two restored-database reconciliation tests. Both tests passed, including cursor resume and duplicate-event financial idempotency. Both disposable databases were dropped afterward.

### 2026-10-14 isolated rehearsal

The supported verifier ran with the existing Compose PostgreSQL 17.11 tools and
an explicit new `DR_ARTIFACT_DIRECTORY`. It applied all 53 migrations, created a
204,528-byte custom-format backup and SHA-256 sidecar, restored it into a
separate disposable database, verified the essential identity fixtures and
cursor `4243:4237:4242`, and passed 4/4 restored-state reconciliation tests.
Corrupt-checksum, missing-checksum, truncated-archive, and unavailable-service
cases all failed safely while a marker in the target remained intact. The
successful restore took 18.5 seconds and the complete rehearsal took 118.3
seconds. Both disposable databases were dropped; the fixture artifact was
retained under the ignored local `artifacts/` directory.

This run did not establish RPO: no production backup timestamp, off-host
inventory, retention evidence, provider PITR state, or restore-credential
availability was accessible. No production database was restored, no live Arc
cursor was reset, and no blockchain transaction was sent. A target-host image
rollback was not rehearsed because no isolated target deployment exists; the
exact supported rollback commands are documented above.
