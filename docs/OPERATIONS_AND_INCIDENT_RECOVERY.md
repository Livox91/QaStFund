# Operations and incident recovery

This runbook covers QastFund operational monitoring and controlled recovery. It
does not authorize production deployment, credential rotation, ERPNext writes,
or financial transaction submission.

## Health endpoints and access

| Endpoint                                      | Purpose                                                                      | Data classification                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/health/live`                        | Process liveness only                                                        | Public-safe                                             |
| `GET /api/health/ready`                       | Configuration and PostgreSQL readiness                                       | Public-safe                                             |
| `GET /api/health/dependencies`                | Sanitized integration, transaction, job, incident, and reconciliation health | Operational metadata; restrict at ingress when possible |
| `GET /api/employer/operations/loans/{loanId}` | Organization-scoped loan evidence trace                                      | Employer administrator only                             |

The dependency endpoint is read-only with respect to financial state. It may
evaluate and deliver deduplicated operational incidents. It never runs an
ERPNext sync, advances a reconciliation cursor, submits an on-chain
transaction, or changes ledger history.

The operator loan trace contains safe record IDs, statuses, timestamps,
transaction hashes, masked wallet addresses, canonical contract-event evidence,
ledger entries, audit events, and related incidents. It omits employee names,
email addresses, credentials, signatures, decision input snapshots, and free
text override rationales. Raw USDC `Transfer` logs are not currently persisted;
the transaction hash and canonical escrow event are the link to receipt-level
transfer evidence.

## Signals and freshness definitions

| Signal                     | Healthy definition                                                                                                                  | Configuration                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| API                        | `/api/health/live` returns `200`                                                                                                    | Container probe interval                                                    |
| Database                   | `SELECT 1` succeeds and required configuration validates                                                                            | Readiness probe                                                             |
| ERPNext                    | Enabled integrations are connected, the latest result is `SUCCESS`, and every integration has a success inside the freshness window | `ERP_NEXT_SYNC_STALE_AFTER_MINUTES`                                         |
| ERPNext records            | No unmatched, ambiguous, duplicate, or unmapped employee records                                                                    | Review queue count                                                          |
| Reconciliation             | Last success is fresh, no conflict is active, and cursor lag is within one configured health window                                 | `ARC_RECONCILIATION_STALE_AFTER_MINUTES`, confirmation depth, block range   |
| Transaction submission     | Intent exists but no transaction hash has been bound                                                                                | Count only; operator investigates prolonged records                         |
| Transaction confirmation   | A hash is bound but the receipt-driven state transition is incomplete                                                               | `OBSERVABILITY_TRANSACTION_STALE_AFTER_MINUTES` marks the outcome ambiguous |
| Transaction reconciliation | Off-chain confirmation exists but no matching `APPLIED` canonical event is journaled                                                | Reconciliation freshness and backlog                                        |
| Scheduler                  | The persisted next-expected time plus grace has not passed and the failure streak is zero                                           | `OBSERVABILITY_SCHEDULER_GRACE_SECONDS`                                     |
| Repayment                  | `OVERDUE`, or `ACTIVE` with the single contractual `repaymentDueAt` in the past                                                     | Actual one-payment schedule stored on `Loan`                                |
| Alert delivery             | No incident has a pending failed delivery                                                                                           | `OBSERVABILITY_ALERT_RETRY_MINUTES`                                         |

Known failed-operation and repeated-repayment counters use the transaction
staleness interval as their rolling observation window. The failed database
records remain preserved after the alert recovers.

`ERP_NEXT_ELIGIBILITY_MAX_AGE_MINUTES` remains an authorization freshness
control and is not used as the operational sync-health threshold. A historical
success never overrides a stale current state.

## Transaction phases

- `SUBMISSION`: an authoritative intent exists without a transaction hash.
- `CONFIRMATION`: a transaction hash exists but its canonical receipt-driven
  transition has not completed.
- `RECONCILIATION`: the application recorded a confirmed outcome but has not
  journaled the matching finalized contract event.
- `CONFIRMED`: canonical receipt checks completed for the operation.
- `FAILED`: the existing receipt or provider operation produced a known failed
  outcome.

An ambiguous `CONFIRMATION` must never be converted into a fresh submission by
an automatic retry. Resolve the original hash first.

## Incidents and alert delivery

Operational incidents are persisted in `OperationalIncident`. The
`deduplicationKey` identifies one condition across process restarts. Repeated
observations increment the occurrence count without redelivering the same
active alert. A failed delivery remains pending and is retried after the
configured cooldown. Transition from active to healthy sends one `RECOVERED`
notification.

Every delivered payload contains severity (`WARNING` or `CRITICAL`), event time,
active or recovered state, subsystem, incident kind, a safe reference ID, a
concise summary, a remediation instruction, and non-sensitive metadata.
Current automatic conditions are critical because they involve stale authority,
ambiguous financial outcomes, canonical discrepancies, repeated failures,
missed scheduling, or failed alert delivery. `WARNING` is reserved for future
pre-threshold capacity or latency signals.

Delivery uses the existing structured log channel or
`OPERATIONAL_ALERT_WEBHOOK_URL`. The bearer token is placed only in the HTTP
authorization header. A webhook failure is persisted, logged with redaction,
and surfaced in health; it is not sent through customer email.

## Escalation

1. Acknowledge the incident using its safe incident/reference ID.
2. For `CRITICAL`, stop manual retries of the affected financial operation and
   notify the on-call application and finance/ledger operators.
3. Preserve transaction hashes, receipts, cursor values, event rows, audit
   records, and logs before corrective action.
4. Escalate contract/RPC discrepancies to the blockchain operator. Escalate
   employee-source conflicts to the authorized ERPNext owner. Do not disclose
   application credentials.
5. Close only after health clears, recovery delivery is verified or documented,
   and the applicable checks below pass.

## Recovery runbooks

### Stale reconciliation cursor

1. Capture dependency health, cursor, finalized head, backlog, discrepancy
   counts, and incident ID.
2. Verify chain ID, contract, RPC, and confirmation depth. Do not edit
   `nextBlock` directly.
3. Run one bounded pass with `npm run reconcile:arc`. The lease, range limit,
   reorg window, and unique event key make replay controlled and idempotent.
4. Repeat only while the cursor advances and no new conflict appears.
5. Verify lag is inside the health window and recovery is delivered once.

### Failed or partial ERPNext synchronization

1. Inspect the latest correlation ID, safe error code, result, unresolved count,
   and paused state in the employer integration view.
2. Correct local configuration or review unmatched records. Do not write to
   ERPNext from this recovery process.
3. Coordinate authentication or permission changes with the ERPNext owner; this
   runbook does not authorize credential rotation.
4. Run one controlled sync and verify `SUCCESS` plus restored freshness.

### Ambiguous submission or confirmation

1. Locate the bound transaction hash through the operator loan trace.
2. Query the canonical receipt and verify chain, contract, status, decoded
   event, participants, and amount.
3. If pending, recheck the same hash. Do not submit a replacement.
4. If reverted, preserve the receipt and wait for the known failed state before
   creating any new user-authorized intent.
5. If successful but not persisted, follow reconciliation recovery below.

### Persistence failed after successful chain execution

1. Preserve the successful receipt and transaction hash.
2. Run bounded reconciliation from the persisted cursor. Events are keyed by
   chain, contract, transaction hash, and log index.
3. Inspect the journal for `APPLIED`, `UNMATCHED`, or `CONFLICT`.
4. Do not resubmit or fabricate a ledger entry. Escalate unmatched/conflict
   evidence for an auditable repair.

### Duplicate event or replay

1. Replay only through the configured range and reorganization window.
2. Verify the existing event is reused and no duplicate loan, repayment, or
   ledger transaction is created.
3. Preserve `REORGED`, `UNMATCHED`, and `CONFLICT` history.

### Notification delivery failure

1. Check pending/failed delivery counts and safe timestamps.
2. Verify the receiver using a test endpoint with synthetic data only.
3. Correct reachability or authorization through approved configuration.
4. Wait for cooldown or run one controlled health evaluation, then verify the
   pending delivery clears.

### Scheduler restart or missed execution

1. Inspect the persisted heartbeat and scheduler container logs.
2. Restart only the existing `reconciliation-scheduler` service.
3. Verify the authenticated endpoint updates the same heartbeat.
4. Reconciliation resumes from its cursor; ERPNext selects only due
   integrations. Do not reset cursors or create financial submissions.
5. Verify the missed/failing incident recovers.

No in-process component can alert while the application, database, and
scheduler are all unavailable. An external uptime check must poll liveness,
readiness, and dependency health to detect that total outage.

## Verification criteria

- Liveness/readiness respond without sensitive error details.
- ERPNext attempt, success, result, safe correlation ID, freshness, and
  unresolved count agree with stored sync records.
- Reconciliation cursor, finalized head, lag, failure, and discrepancy counts
  agree with the journal.
- Transaction phase and overdue counts agree with source records.
- Alerts deduplicate, retry failed delivery after cooldown, and recover once.
- Employer admins can retrieve only their organization’s trace; employees and
  cross-organization requests cannot.
- Replay does not duplicate events, repayments, loans, or ledger transactions.
- Recovery does not rewrite ledger history or resubmit an unknown outcome.

Local unit and mocked-webhook tests prove transition and redaction behavior,
not production reachability. Database/concurrency tests require migrated
PostgreSQL; Arc recovery tests require the local chain. Production evidence also
requires external uptime polling, scheduler logs, provider delivery receipts,
and an approved non-financial smoke test.
