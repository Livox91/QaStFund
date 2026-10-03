# ERPNext employee directory integration

The implementation lives in `src/modules/employee-directory`. It uses the
Frappe REST resource API in read-only mode and sends only `GET` requests for
standard `Employee` fields. The default path is `/api/resource` (API v1), with
the compatible resource path and installed API version configurable per tenant.
An API path may contain `{version}`, for example `/api/{version}/resource`.

Credentials are not stored in Prisma. Set `ERP_NEXT_CREDENTIALS_JSON` to a
server-only JSON object keyed first by organization UUID and then by the
reference entered in the employer form:

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
