# Arc reconciliation

The reconciliation worker recovers finalized `OfferCreated`, `LoanStarted`, and
`LoanRepaid` events when a browser confirmation callback is missed. It never
sends a transaction and never creates an unmatched financial record.

Configure the `ARC_RECONCILIATION_*` variables documented in `.env.example`.
`ARC_RECONCILIATION_START_BLOCK` should be the deployed escrow's block.

Run one bounded pass locally with:

```shell
npm run reconcile:arc
```

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
