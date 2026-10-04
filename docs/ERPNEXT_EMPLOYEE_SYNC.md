# ERPNext employee synchronization runbook

## Scope and ownership

The integration reads ERPNext's `Employee` resource. It never writes to ERPNext, changes payroll, makes lending decisions, moves funds, or changes blockchain state. PostgreSQL remains authoritative for application users, organization membership, access, loans, offers, repayments, and audit history. ERPNext is authoritative only for the imported employee identity (`name`), descriptive employee fields, and the configured employment-status signal.

The stable key is ERPNext `Employee.name`, stored as `externalEmployeeId` together with the organization and integration IDs. Email is used only for the first, unambiguous match to an existing employee membership. A stored external-ID mapping is used thereafter. Database composite foreign keys prevent a mapping or sync run from referring to a membership or integration in another organization.

An ERPNext status changes only `OrganizationMembership.employmentStatus`, its source, and its sync timestamp. It does not delete or disable the membership and does not modify financial records. A previously matched employee missing from a complete ERPNext snapshot is suspended (unless already terminated). This is reversible on a later sync. Suspended and terminated employees can still authenticate to view historical loans, offers, and repayments, while transactional repository checks require active employment for new borrowing and lending.

## Scheduling and configuration

Configure the integration at `/employer/integrations`. Saving an organization-scoped integration makes that organization eligible for scheduling. Scheduling also requires the global worker switch and server-only credentials:

```dotenv
ERP_NEXT_SYNC_ENABLED="true"
ERP_NEXT_SYNC_INTERVAL_MINUTES="1440"
ERP_NEXT_SYNC_STALE_AFTER_MINUTES="30"
ERP_NEXT_SYNC_PAGE_SIZE="100"
ERP_NEXT_SYNC_MAX_PAGES="100"
ERP_NEXT_SYNC_CRON_SECRET="at-least-32-random-characters"
ERP_NEXT_CREDENTIALS_JSON='{"organization-uuid":{"credential-reference":{"apiKey":"...","apiSecret":"..."}}}'
```

Do not commit the last two values or print them in logs. `ERP_NEXT_CREDENTIALS_JSON` is server-only and keyed first by organization ID, then by the reference saved in PostgreSQL. OAuth bearer credentials use `accessToken` instead of the token pair.

An external scheduler invokes the lightweight in-application worker. No separate queue is required:

```bash
curl --fail-with-body --request POST \
  --header "Authorization: Bearer $ERP_NEXT_SYNC_CRON_SECRET" \
  https://application.example/api/internal/erpnext-sync
```

Run the trigger at least as often as `ERP_NEXT_SYNC_INTERVAL_MINUTES`. The application selects only configured, due, non-paused organizations. It retrieves bounded pages, processes organizations sequentially, and uses a PostgreSQL advisory lock plus a unique running-job index to prevent overlap for one organization.

## Transaction and restart behavior

The worker retrieves a complete bounded ERPNext snapshot before changing mappings or memberships. If any page times out, is malformed, fails authentication, or otherwise fails, the run is recorded as failed and no employee-directory changes are committed. Mapping, employment-status changes, counters, integration health, and the completion audit event are then committed in one PostgreSQL transaction.

After a process or scheduler restart, a running job is protected from overlap until `ERP_NEXT_SYNC_STALE_AFTER_MINUTES`. The next attempt marks an older abandoned run failed and starts the full idempotent snapshot again. It does not resume mid-page because no partial page result is ever committed. `ERP_NEXT_SYNC_MAX_PAGES` fails closed if a remote cursor never terminates.

Authentication, permission, missing-credential, unsafe-URL, invalid-configuration, missing-resource, and page-limit errors pause scheduled attempts to avoid an infinite failure loop. Correct the configuration and run a manual synchronization; a successful completion clears the pause. Timeouts, rate limits, and remote server failures remain retryable on the next scheduled invocation.

## Operator status

The employer integration page shows whether global scheduling is enabled, last attempt, last success, current/latest state, next due time, safe error text, duration, and processed/created/updated/deactivated/unchanged/review counts. The dependency-health endpoint and operational counters also report sanitized ERPNext failures. Correlation IDs link a displayed run to logs; credentials, authorization headers, and remote response bodies are never included.

## Failure procedure

1. Open `/employer/integrations` and record the correlation ID, error code, last attempt, last success, and whether scheduling is paused.
2. For `AUTHENTICATION_FAILED` or `MISSING_CREDENTIALS`, rotate/fix the server-side secret without putting it in a ticket or command history. Keep the same organization-scoped reference when possible.
3. For `PERMISSION_DENIED`, grant the ERPNext service identity read permission to `Employee` only. No write permission is needed.
4. For `REQUEST_TIMEOUT`, `RATE_LIMITED`, or `REMOTE_SERVER_ERROR`, verify ERPNext availability and allow the next scheduled attempt or use the manual retry.
5. For `REMOTE_RESPONSE_INVALID`, inspect ERPNext version/customization changes. Do not replay a partial response; the failed run made no directory changes.
6. For `SYNC_LIMIT_EXCEEDED`, verify ERPNext pagination, then deliberately raise `ERP_NEXT_SYNC_MAX_PAGES` or reduce the source population/filtering. Keep `ERP_NEXT_SYNC_PAGE_SIZE` within 10–1000.
7. Test the connection, then run a manual sync. Confirm a new successful timestamp and expected counters before considering the incident recovered.

## ERPNext pilot prerequisites

- A dedicated ERPNext service identity with read-only access to `Employee`.
- Employee records with stable `name` values and usable `employee_name`, email, and `status` fields.
- A reviewed mapping for every ERPNext status used by the pilot. Unknown statuses go to review and never silently change membership status.
- A server-side credential entry under the correct organization UUID and saved credential reference.
- An HTTPS ERPNext base URL resolvable to a public address in production. Local HTTP is a development-only opt-in.
- An external HTTPS cron capable of sending the bearer-authenticated POST shown above.

## Verification commands

The automated suite mocks ERPNext; it does not require a live ERPNext system. PostgreSQL-backed tests require the local database and all migrations:

```powershell
docker compose up -d postgres
npm run prisma:deploy
npm test -- tests/erpnext-employee-directory.test.ts tests/erpnext-employee-directory-database.test.ts
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

The focused tests cover the first and repeat sync, field/status updates, complete-snapshot deactivation, transient/authentication/malformed/partial-page failures, restart recovery, overlap prevention, stable-key duplicate prevention, bounded pagination, and cross-organization database isolation.

Last verified on 2026-10-04 with Docker PostgreSQL: migration deploy applied all 29 migrations; the ERPNext suites passed 30 tests; the full suite passed 267 tests in 41 files with one intentional skip; type checking, ESLint, formatting, and the Next.js production build passed. No live ERPNext instance was used or required—the adapter responses were mocked while persistence, locking, restart, duplicate, and tenant-isolation behavior ran against PostgreSQL.
