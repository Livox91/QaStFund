# ERPNext employee directory integration

The implementation lives in `src/modules/employee-directory`. It uses the
Frappe REST resource API in read-only mode and sends only `GET` requests for
standard `Employee` fields. The default path is `/api/resource` (API v1), with
the compatible resource path and installed API version configurable per tenant.
An API path may contain `{version}`, for example `/api/{version}/resource`.

The employer form accepts the ERPNext API key and secret (or OAuth access
token) directly. The server encrypts the credential with AES-256-GCM using
`ERP_NEXT_CREDENTIAL_ENCRYPTION_KEY`, stores only ciphertext in the dedicated
credential table, and saves only a generated `managed:<uuid>` reference in the
integration record. Plaintext credentials are never returned to the browser.
Generate a local encryption key once and keep it stable:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Set the output as `ERP_NEXT_CREDENTIAL_ENCRYPTION_KEY` in `.env`. The older
operator-managed environment provider remains supported for existing
integrations. Its `ERP_NEXT_CREDENTIALS_JSON` value is a server-only JSON object
keyed first by organization UUID and then by the existing database reference:

```json
{
  "organization-uuid": {
    "primary": { "apiKey": "key", "apiSecret": "secret" },
    "oauth": { "accessToken": "token" }
  }
}
```

Use a dedicated ERPNext user with read permission only for Employee. Never use
Administrator. HTTPS and public DNS addresses are required. For local
development only, `ERP_NEXT_ALLOW_LOCAL_HTTP=true` permits loopback HTTP.

See `docs/ERPNEXT_LOCAL_SETUP.md` for the employer-facing setup and verification
flow.

## Scheduled synchronization

Scheduling uses the same synchronization service and database lock as the
employer's manual action. The application exposes a protected trigger instead
of starting an in-process timer, so it remains safe with multiple Next.js
instances and serverless deployments.

Configure:

```dotenv
ERP_NEXT_SYNC_ENABLED="true"
ERP_NEXT_SYNC_INTERVAL_MINUTES="1440"
ERP_NEXT_SYNC_STALE_AFTER_MINUTES="30"
ERP_NEXT_SYNC_CRON_SECRET="replace-with-at-least-32-random-characters"
```

Call the trigger from cron, a cloud scheduler, or Windows Task Scheduler at
least as often as the configured interval. Calling it more often is safe: the
server selects only due organizations.

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/internal/erpnext-sync" `
  -Headers @{ Authorization = "Bearer $env:ERP_NEXT_SYNC_CRON_SECRET" }
```

Authentication and permission failures pause scheduled runs for that
organization. After correcting the credential or permissions, use **Retry
synchronization** in the employer dashboard; a successful run resumes the
schedule.

## Employee lifecycle

ERPNext `Employee.name` is the stable identity key. A complete sync provisions
new active employees as inactive invitees without creating wallets, updates mapped
identity fields, soft-deactivates employees who are inactive or absent from the
complete snapshot, revokes their sessions, and reactivates the same membership
when they return. Financial records and on-chain references are never deleted
or changed by directory synchronization. Employers can inspect active and
former employees, including preserved loan and audit history, at
`/employer/employees`.

The first sync creates one expiring, hashed-token invitation and sends it to the
official ERPNext email. Repeat syncs are idempotent. Acceptance proves control
of that address, lets the employee create a password, and activates only the
mapped membership in the invitation's organization. Employers can resend
(rotating the token) or revoke a pending invitation from the employee list.
