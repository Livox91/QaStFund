# ERPNext employee synchronization runbook

For the production service-account permission checklist and live acceptance evidence, see [`ERPNEXT_PRODUCTION_VALIDATION.md`](./ERPNEXT_PRODUCTION_VALIDATION.md). Live ERPNext and real-provider validation are required before production sign-off.

## Scope and ownership

The integration reads ERPNext's `Employee` resource. It never writes to ERPNext, changes payroll, makes lending decisions, moves funds, or changes blockchain state. PostgreSQL remains authoritative for application users, organization membership, access, loans, offers, repayments, and audit history. ERPNext is authoritative only for the imported employee identity (`name`), descriptive employee fields, and the configured employment-status signal.

The stable key is ERPNext `Employee.name`, stored as `externalEmployeeId` together with the organization and integration IDs. Email is used only for the first, unambiguous match to an existing employee membership. A stored external-ID mapping is used thereafter. Database composite foreign keys prevent a mapping or sync run from referring to a membership or integration in another organization.

An active ERPNext employee with an email and no existing P2P membership is provisioned with an unclaimed, inactive account and an expiring invitation. The invitation is delivered after the reconciliation transaction commits. Until the employee follows that organization-scoped link and creates a password, the membership has no application access. A stable external-ID mapping is written in the same transaction. Later name, email, department, designation, and status changes update that identity through the mapping instead of creating another user.

Configure the outbound email gateway used for invitations and password resets:

```dotenv
EMAIL_DELIVERY_ENDPOINT="https://mail-gateway.example/send"
EMAIL_DELIVERY_TOKEN="server-only-bearer-token"
EMAIL_FROM="Employee Lending <no-reply@example.com>"
```

The gateway receives a JSON message containing `from`, `to`, `subject`, `text`, and `html`, plus an `Idempotency-Key` header. If delivery fails, the employee remains inactive, the invitation records an explicit `FAILED` delivery state and safe failure code, and a later sync or employer resend can retry. Successful delivery records `SENT`; invitation acceptance remains a separate lifecycle state. Tokens are never stored in plaintext or written to application logs.

An inactive ERPNext status, or a previously mapped employee missing from a complete unfiltered Employee snapshot, soft-deactivates the membership, records `removedAt`, revokes pending invitations, and revokes its sessions. No user, membership, loan, offer, repayment, ledger, wallet, transaction reference, or audit record is deleted. Outstanding loans continue unchanged. If the same external employee becomes active again, the existing accepted account is reactivated and `removedAt` is cleared; an employee who never accepted is invited again but remains inactive. Financial history remains attached to the same membership in either case.

Repeated syncs do not create duplicate employees or pending invitations. Before acceptance, an ERPNext email change revokes the old invitation and sends a new one to the updated official address. After acceptance, sync continues to store the new official directory email but does not silently replace the user's authentication email.

## Scheduling and configuration

Configure the integration at `/employer/integrations`. The employer enters the ERPNext credential there; the server encrypts it and stores only an opaque reference with the organization integration. Saving an organization-scoped integration makes that organization eligible for scheduling. Scheduling also requires the global worker switch and server-only encryption key:

```dotenv
ERP_NEXT_SYNC_ENABLED="true"
ERP_NEXT_SYNC_INTERVAL_MINUTES="1440"
ERP_NEXT_SYNC_STALE_AFTER_MINUTES="30"
ERP_NEXT_SYNC_PAGE_SIZE="100"
ERP_NEXT_SYNC_MAX_PAGES="100"
ERP_NEXT_SYNC_CRON_SECRET="at-least-32-random-characters"
ERP_NEXT_CREDENTIAL_ENCRYPTION_KEY="base64-encoded-32-byte-key"
```

Do not commit the last two values or print them in logs. The encryption key is server-only and must remain stable across restarts. Existing operator-managed integrations may continue to use `ERP_NEXT_CREDENTIALS_JSON`, keyed first by organization ID and then by their saved legacy reference. OAuth bearer credentials use `accessToken` instead of the token pair.

An external scheduler invokes the lightweight in-application worker. No separate queue is required:

```bash
curl --fail-with-body --request POST \
  --header "Authorization: Bearer $ERP_NEXT_SYNC_CRON_SECRET" \
  https://application.example/api/internal/erpnext-sync
```

Run the trigger at least as often as `ERP_NEXT_SYNC_INTERVAL_MINUTES`. The application selects only configured, due, non-paused organizations. It retrieves bounded pages, processes organizations sequentially, and uses a PostgreSQL advisory lock plus a unique running-job index to prevent overlap for one organization.

## Transaction and restart behavior

The worker retrieves a complete bounded ERPNext snapshot before changing mappings or memberships. If any page times out, is malformed, fails authentication, or otherwise fails, the run is recorded as failed and no employee-directory changes are committed. User and membership provisioning, mapping changes, lifecycle/access changes, session revocation, counters, integration health, and audit events are then committed in one PostgreSQL transaction.

After a process or scheduler restart, a running job is protected from overlap until `ERP_NEXT_SYNC_STALE_AFTER_MINUTES`. The next attempt marks an older abandoned run failed and starts the full idempotent snapshot again. It does not resume mid-page because no partial page result is ever committed. `ERP_NEXT_SYNC_MAX_PAGES` fails closed if a remote cursor never terminates.

Authentication, permission, missing-credential, unsafe-URL, invalid-configuration, missing-resource, and page-limit errors pause scheduled attempts to avoid an infinite failure loop. Correct the configuration and run a manual synchronization; a successful completion clears the pause. Timeouts, rate limits, and remote server failures remain retryable on the next scheduled invocation.

## Operator status

The employer integration page shows whether global scheduling is enabled, last attempt, last success, current/latest state, next due time, safe error text, duration, and processed/added/updated/removed/reactivated/unchanged/review counts. The dependency-health endpoint and operational counters also report sanitized ERPNext failures. Correlation IDs link a displayed run to logs; credentials, authorization headers, and remote response bodies are never included.

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
- A credential saved through the employer integration form, or a legacy server-side environment entry matching its saved reference.
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

The focused tests cover five-run idempotency, inactive pre-acceptance access, hashed and rotated invitation tokens, backend email matching, tenant isolation, password change/reset and session revocation, stable-ID field updates, complete-snapshot removal, outstanding-loan and repayment preservation, rehire, transient/authentication/malformed/partial-page failures, restart recovery, overlap prevention, and bounded pagination.

Last verified on 2026-10-05 with Docker PostgreSQL: migration deploy applied all 36 migrations; the focused ERPNext/email/security suites passed 46 tests; the full suite passed 298 tests in 47 files with one intentional skip; type checking, ESLint, formatting, and the Next.js production build passed. No live ERPNext instance was available—the adapter responses were mocked while persistence, invitation delivery state, password/token lifecycle, locking, restart, duplicate, and tenant-isolation behavior ran against PostgreSQL.
