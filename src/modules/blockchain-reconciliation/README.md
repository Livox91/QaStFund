# Arc reconciliation

The reconciliation worker recovers finalized `OfferCreated`, `LoanStarted`, and
`LoanRepaid` events when a browser confirmation callback is missed. It never
sends a blockchain transaction and never creates an unmatched financial
record. It does write database state: it acquires a lease, advances the cursor,
journals observed events, and can apply a finalized event to an already-matched
offer, loan, repayment, ledger, or audit record.

Setting `ARC_RECONCILIATION_ENABLED=true` permits reconciliation. In the
production Compose deployment, the `reconciliation-scheduler` sidecar calls the
internal endpoint every `ARC_RECONCILIATION_INTERVAL_SECONDS` (60 seconds by
default). A non-Compose deployment must provide an equivalent authenticated
trigger.

Configure the `ARC_RECONCILIATION_*` variables documented in `.env.example`.
`ARC_RECONCILIATION_START_BLOCK` should be the deployed escrow's block.

Run one bounded pass locally with:

```shell
npm run reconcile:arc
```

Review the configured contract and start block before running this command. The
Arc pilot preflight is read-only with respect to reconciliation and will not
invoke the worker; it requires an existing healthy persisted cursor instead.

Run a read-only comparison of linked database records, escrow state, stale
intents, and reconciliation journal exceptions with:

```shell
npm run audit:arc
```

The audit never writes application or chain state. It exits non-zero when it
finds a mismatch and checks at most 500 records per category in one run.

The sidecar sends an authenticated `POST` over the Compose-internal network to
`/api/internal/arc-reconciliation` with
`Authorization: Bearer <ARC_RECONCILIATION_CRON_SECRET>`. The token is read from
the protected environment, is not placed in process arguments, and is never
logged. The database lease makes overlapping invocations safe.

The cursor resumes from the last scanned block and rewinds by
`ARC_RECONCILIATION_REORG_WINDOW` on each pass. Events remain provisional until
they are at least `ARC_RECONCILIATION_CONFIRMATIONS` blocks behind the head.
Disappearing provisional events are marked `REORGED`. A changed or missing
finalized event is never reversed automatically; it is marked `CONFLICT` for
investigation. Unmatched finalized events remain in `BlockchainEvent` with an
investigation code and are retried on later passes, allowing dependencies that
arrive out of order to recover.

Every completed run returns the latest and finalized heads, cursor position,
starting and remaining backlog, per-run block bound, and `caughtUp`. Dependency
health independently calculates finalized-head backlog and marks the worker
stale when it exceeds `ARC_RECONCILIATION_BLOCK_RANGE` or the last success is
older than `ARC_RECONCILIATION_STALE_AFTER_MINUTES`.

Alert state is stored on `BlockchainReconciliationCursor`, so restarts do not
redeliver an unchanged condition. State transitions are emitted to structured
logs. When `OPERATIONAL_ALERT_WEBHOOK_URL` is configured, the same sanitized
JSON payload is delivered by HTTP POST with the optional
`OPERATIONAL_ALERT_WEBHOOK_BEARER_TOKEN`. Failed delivery remains pending and is
retried after five minutes. A transition back to `HEALTHY` emits one recovery.
