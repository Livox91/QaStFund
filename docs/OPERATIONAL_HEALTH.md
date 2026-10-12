# Operational health

The application exposes three uncached, read-only health checks:

- `GET /api/health/live` only confirms that the process can answer HTTP.
- `GET /api/health/ready` (and compatibility route `GET /api/health`) validates required configuration and PostgreSQL connectivity. A failed check returns `503`.
- `GET /api/health/dependencies` reports sanitized Arc RPC/contract, Circle configuration, optional ERPNext state, reconciliation progress, pending transaction count, and the lightweight metric snapshot. Optional dependency failures degrade this report but do not fail readiness.
- `GET /api/employer/operations/loans/{loanId}` provides an employer-admin-only, organization-scoped, redacted evidence trace for incident investigation.

Responses contain statuses, timestamps, counters, block numbers, and safe configuration booleans. They never include URLs, credentials, tokens, signatures, private keys, or raw provider errors. Operators should restrict dependency-health routes at the ingress if their deployment does not permit public operational metadata.

## Alerts and thresholds

Alerts are structured warning logs named `Operational alert triggered`.
Optionally, `OPERATIONAL_ALERT_WEBHOOK_URL` receives the same sanitized JSON by
HTTP POST; `OPERATIONAL_ALERT_WEBHOOK_BEARER_TOKEN` authenticates delivery when
the receiver requires it. Neither setting is exposed in logs or health output.

Failure alerts fire when a streak reaches
`OBSERVABILITY_FAILURE_ALERT_THRESHOLD` (default `3`). Reconciliation is stale
when its last success exceeds `ARC_RECONCILIATION_STALE_AFTER_MINUTES` or its
cursor is more than `ARC_RECONCILIATION_BLOCK_RANGE` blocks behind the finalized
chain head. A reconciliation run also alerts when it observes at least
`OBSERVABILITY_UNMATCHED_EVENT_ALERT_THRESHOLD` unmatched events (default `10`).
Persistent reconciliation alert state suppresses duplicate delivery across
process restarts. Failed webhook delivery remains pending with a five-minute
retry cooldown. Returning to `HEALTHY` emits one recovery notification.

PostgreSQL persists the reconciliation cursor, latest observed block, last
success/failure time, failure streak, active alert state, alert transition time,
delivery-pending flag, and delivery timestamps. Other counters and timers are
intentionally process-local. In a multi-instance deployment, aggregate
structured logs externally and treat the metric snapshot as instance-scoped.

PostgreSQL also persists generic operational incidents and job heartbeats.
Incidents deduplicate across restarts, retain delivery failures, and produce one
recovery transition. The dependency report separates transaction submission,
confirmation, and reconciliation phases; reports overdue loans using the stored
single-payment due date; and marks missed scheduler windows using the configured
grace period. See `OPERATIONS_AND_INCIDENT_RECOVERY.md` for definitions and
recovery procedures.

## Operational signals

The structured logger records transaction submission, confirmation, reversion, pending/unknown receipts, recovered confirmations, unmatched events, reconciliation/RPC failures, Circle failures, ERPNext scheduled-sync failures, API errors, authentication failures, and rate-limit events. Context is recursively redacted before logging.

The production Compose `reconciliation-scheduler` invokes Arc reconciliation
every 60 seconds by default. It is sequential, restartable, internal-only, and
uses the authenticated route. When `ERP_NEXT_SYNC_ENABLED=true`, the same
sidecar also invokes the authenticated ERPNext route at
`ERP_NEXT_SYNC_INTERVAL_MINUTES`. Partial and failed results count toward its
failure threshold and recovery clears the active scheduler alert. ERPNext
dependency health separately exposes configured, connected, incomplete, and
stale integration counts; a successful connection alone is not healthy sync
evidence. Monitoring endpoints never run reconciliation, synchronize
employees, evaluate lending decisions, or perform financial actions.
