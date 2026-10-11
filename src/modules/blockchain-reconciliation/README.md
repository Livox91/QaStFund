# Arc reconciliation

The reconciliation worker recovers finalized `OfferCreated`, `LoanStarted`, and
`LoanRepaid` events when a browser confirmation callback is missed. It never
sends a blockchain transaction and never creates an unmatched financial
record. It does write database state: it acquires a lease, advances the cursor,
journals observed events, and can apply a finalized event to an already-matched
offer, loan, repayment, ledger, or audit record.

Setting `ARC_RECONCILIATION_ENABLED=true` only permits reconciliation. It does
not start a background process. A pass runs only when the CLI command below is
invoked or an authorized scheduler calls the internal endpoint.

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

For a deployed environment, schedule an authenticated `POST` to
`/api/internal/arc-reconciliation` with
`Authorization: Bearer <ARC_RECONCILIATION_CRON_SECRET>`. The database lease
makes overlapping invocations safe.

The cursor resumes from the last scanned block and rewinds by
`ARC_RECONCILIATION_REORG_WINDOW` on each pass. Events remain provisional until
they are at least `ARC_RECONCILIATION_CONFIRMATIONS` blocks behind the head.
Disappearing provisional events are marked `REORGED`. A changed or missing
finalized event is never reversed automatically; it is marked `CONFLICT` for
investigation. Unmatched finalized events remain in `BlockchainEvent` with an
investigation code and are retried on later passes, allowing dependencies that
arrive out of order to recover.
