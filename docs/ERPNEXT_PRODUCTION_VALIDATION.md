# ERPNext production validation

## Current validation status

The application-side integration is implemented and covered by automated tests. On 2026-10-05, the local `erpnext.localhost` site was available for version, resource-read, and least-privilege checks. A real email provider and complete P2P lifecycle configuration were not available, so the remaining acceptance checklist is still a production blocker. Do not represent the integration as production-ready until the evidence table is completed.

Validated locally: ERPNext `17.x.x-develop` (`650da0d`) on Frappe `17.x.x-develop` (`4672706`). The dedicated `p2p.employee.reader@erpnext.local` identity with the `P2P Employee Reader` role returned `200` for an Employee read and `403` for Employee create, Employee delete, and Salary Slip read. Rotate its API secret before configuring P2P; the validation secret was deliberately not printed or retained outside ERPNext.

## ERPNext compatibility and service account

The adapter uses Frappe's read-only REST resource API (`GET /api/resource/Employee`) and configurable API path/version. Validate the exact deployed ERPNext/Frappe version with **Test connection** before syncing.

Create a dedicated System User and a dedicated role such as `P2P Employee Reader`. In Role Permission Manager, grant only `Employee` document **Read** permission. Do not grant Create, Write, Delete, Submit, Cancel, Amend, Import, Export, payroll, salary, accounts, or administrator roles. Issue an API key/secret for that user and save it through `/employer/integrations`; the application encrypts it and never returns it to the browser.

Prove least privilege before sign-off:

1. `GET /api/resource/Employee?limit_page_length=1` succeeds.
2. Reading the configured Employee fields succeeds.
3. Creating, updating, and deleting an Employee is denied.
4. Payroll, Salary Slip, and accounting resource requests are denied.
5. **Test connection** reports `PERMISSION_DENIED` when Employee read permission is removed.

## Required application configuration

```dotenv
APP_URL="https://p2p.example.com"
ERP_NEXT_CREDENTIAL_ENCRYPTION_KEY="base64-encoded-32-byte-key"
ERP_NEXT_SYNC_ENABLED="true"
ERP_NEXT_SYNC_INTERVAL_MINUTES="1440"
ERP_NEXT_SYNC_STALE_AFTER_MINUTES="30"
ERP_NEXT_SYNC_PAGE_SIZE="100"
ERP_NEXT_SYNC_MAX_PAGES="100"
ERP_NEXT_SYNC_CRON_SECRET="at-least-32-random-characters"
EMAIL_DELIVERY_ENDPOINT="https://mail-gateway.example/send"
EMAIL_DELIVERY_TOKEN="server-only-bearer-token"
EMAIL_FROM="Employee Lending <no-reply@example.com>"
```

The email gateway must accept bearer authentication and JSON fields `from`, `to`, `subject`, `text`, and `html`. It should honor the `Idempotency-Key` header. Any non-2xx response is a failed delivery; the application stores a safe failure code and does not set `sentAt`.

## Status mapping

Inspect distinct status values returned by the live Employee records, then configure every value explicitly in `/employer/integrations`. Map working statuses to `ACTIVE`; map confirmed separation statuses to `TERMINATED` or `SUSPENDED` according to policy. Unknown values remain review records, make the sync partial, and never deactivate an existing employee automatically.

## Scheduler

Invoke `POST /api/internal/erpnext-sync` from one external scheduler at least as often as `ERP_NEXT_SYNC_INTERVAL_MINUTES`:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://p2p.example.com/api/internal/erpnext-sync" `
  -Headers @{ Authorization = "Bearer $env:ERP_NEXT_SYNC_CRON_SECRET" }
```

The endpoint uses constant-time bearer verification and IP rate limiting. It returns `401` for disabled/invalid authentication, `429` with `Retry-After` when rate-limited, or `200` with `considered`, `succeeded`, `partial`, `failed`, and `skipped` totals. Per-organization database locks reject overlap safely. Retry transient failures on the next schedule; permanent authentication, permission, configuration, and safety failures pause that organization's schedule until a successful manual retry.

## Live acceptance evidence

Use real test inboxes and record IDs/timestamps without recording secrets or bearer tokens.

| Scenario                   | Required evidence                                                                                              | Status         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- |
| Connection and permissions | ERPNext v17/Frappe v17; dedicated role; Employee read `200`; Employee create/delete and Salary Slip read `403` | Passed locally |
| Initial sync               | Alice, Bob, Charlie, and John values match ERPNext                                                             | Not executed   |
| Email delivery             | Provider delivery IDs for four invitations                                                                     | Not executed   |
| Alice acceptance           | Active membership, successful login                                                                            | Not executed   |
| Bob ignored                | Invited state, authentication denied                                                                           | Not executed   |
| John leaves                | Former state, sessions revoked, history preserved                                                              | Not executed   |
| John rehired               | Same membership/wallet/history, no duplicate                                                                   | Not executed   |
| Charlie email change       | Old token invalid, new address delivered                                                                       | Not executed   |
| Repeat sync                | No duplicate users, mappings, or invitations                                                                   | Not executed   |
| Password reset             | Delivered link works once and revokes sessions                                                                 | Not executed   |
| Scheduler                  | Auth, rate limit, overlap skip, and retry observed                                                             | Not executed   |

## Lifecycle boundary

`ERPNext Active → P2P Invited → P2P Active → ERPNext Inactive → P2P Former Employee → ERPNext Active Again → same P2P Active account`

ERPNext supplies employee identity, official email, and employment status only. Payroll, attendance, leave, expenses, accounting, lending decisions, ERPNext write-back, and blockchain transactions remain out of scope.
