# Operational health

The application exposes three uncached, read-only health checks:

- `GET /api/health/live` only confirms that the process can answer HTTP.
- `GET /api/health/ready` (and compatibility route `GET /api/health`) validates required configuration and PostgreSQL connectivity. A failed check returns `503`.
- `GET /api/health/dependencies` reports sanitized Arc RPC/contract, Circle configuration, optional ERPNext state, reconciliation progress, pending transaction count, and the lightweight metric snapshot. Optional dependency failures degrade this report but do not fail readiness.

Responses contain statuses, timestamps, counters, block numbers, and safe configuration booleans. They never include URLs, credentials, tokens, signatures, private keys, or raw provider errors. Operators should restrict dependency-health routes at the ingress if their deployment does not permit public operational metadata.

## Alerts and thresholds

Alerts are structured warning logs named `Operational alert triggered`; no notification provider is required. Failure alerts fire when a streak first reaches `OBSERVABILITY_FAILURE_ALERT_THRESHOLD` (default `3`) and reset after a success. Reconciliation is stale after `ARC_RECONCILIATION_STALE_AFTER_MINUTES` (default `15`). A reconciliation run also alerts when it observes at least `OBSERVABILITY_UNMATCHED_EVENT_ALERT_THRESHOLD` unmatched events (default `10`).

PostgreSQL persists the reconciliation cursor, latest observed block, last success/failure time, and failure streak. Other counters and timers are intentionally process-local. In a multi-instance deployment, aggregate structured logs externally and treat the metric snapshot as instance-scoped.

## Operational signals

The structured logger records transaction submission, confirmation, reversion, pending/unknown receipts, recovered confirmations, unmatched events, reconciliation/RPC failures, Circle failures, ERPNext scheduled-sync failures, API errors, authentication failures, and rate-limit events. Context is recursively redacted before logging.

The Arc and ERPNext workers remain scheduler-driven. Monitoring endpoints never run reconciliation, synchronize employees, evaluate lending decisions, or perform financial actions.
