# ERPNext / Frappe HR payroll integration

## Current diagnosis

QastFund previously implemented only a read-only Employee directory adapter.
Payroll writes were explicitly unimplemented, and the validated directory
identity returned HTTP 403 for Salary Slip reads. The local workspace contains
PostgreSQL but no Frappe container, so Frappe master data cannot be changed or
live salary documents created here. The persisted Employee integration is
healthy and its stable Employee mappings are complete.

The 2026-10-18 read-only probe found Frappe `17.0.0-dev` and ERPNext
`17.0.0-dev` on `develop`, but HRMS `15.64.5` on `version-15`. Frappe HR's
branching policy requires matching release branches, so this mixed major-version
installation is unsupported and must be aligned before payroll sign-off. The
same probe found Company, Department, Salary Component, Salary Structure, and
Payroll Entry records, but **no Salary Structure Assignment** and no Salary
Slip. An effective submitted assignment is therefore the immediate data blocker
even before attempting creation.

The payroll adapter is therefore a separate opt-in boundary. Do not expand the
directory reader's privileges. Configure a dedicated payroll identity only on
a development or staging Frappe site before executing creation tests.

## Required Frappe HR configuration

Before creating a Salary Slip, verify in Frappe HR:

1. Frappe Framework, ERPNext, and HRMS are installed on the same compatible
   release line (`bench version` and `bench --site <site> list-apps`).
2. Company and its default currency are configured.
3. Employee is Active, belongs to the Company, and the payroll period is
   within joining and relieving dates.
4. Required earning and deduction Salary Components exist with their accounts
   and formulas configured.
5. A submitted Salary Structure exists and a submitted, effective Salary
   Structure Assignment covers the employee and period.
6. Payroll frequency and period dates match. Configure attendance, leave,
   holidays, timesheets, tax slabs, and payroll settings only when the chosen
   Salary Structure requires them.

The integration does not bypass any validation. Frappe creates the draft via
`POST /api/resource/Salary Slip`, which runs the Salary Slip document hooks and
payroll calculations. A failed Frappe validation is returned as the safe code
`PAYROLL_VALIDATION_FAILED`; inspect Frappe's Error Log as an authorized HR
operator for the detailed validation message.

## Service-account permissions

Use a dedicated System User and role. Required minimum permissions are:

- Read: Employee, Company, Salary Structure Assignment, Salary Slip.
- Create: Salary Slip.
- Link/read permissions required by the installed HRMS version for the Salary
  Slip controller to resolve Salary Structure and components.
- No Submit, Cancel, Amend, Delete, Import, Export, Accounts Manager, System
  Manager, or Administrator permissions.

If the installed HRMS controller requires another linked DocType, add only its
Read permission after reproducing the explicit permission error in staging.
QastFund intentionally provides no API operation for submission or cancellation.

## Environment

```dotenv
# JSON is server-only and keyed by QastFund organization UUID.
ERP_NEXT_PAYROLL_CREDENTIALS_JSON='{"organization-uuid":{"apiKey":"...","apiSecret":"..."}}'
ERP_NEXT_PAYROLL_MAX_AGE_DAYS="45"
```

OAuth can be used with `{ "accessToken": "..." }`. Never commit or print the
JSON value. Production should inject it through the existing secret manager.
The payroll adapter inherits the organization's already validated ERPNext base
URL, API path, timeout, and SSRF restrictions.

## Mapping and stored data

`EmployeeDirectoryMapping.externalEmployeeId` is the authoritative Frappe
`Employee.name`; names and email addresses are never used for payroll matching.
QastFund stores only:

- external Salary Slip identifier;
- mapped employee ID and payroll period;
- gross pay, net pay, currency, document status, source modification time, and
  synchronization time.

It does not persist child earning/deduction rows or return full Salary Slip
documents. The database uniqueness constraints prevent duplicate evidence for
one external slip or employee/period.

Only submitted Salary Slips (`docstatus = 1`) may supply verified net income to
new loan-decision snapshots. Missing, draft, cancelled, stale, or
currency-inconsistent evidence remains unavailable; it is never converted to
zero and the existing rules route the application to manual review. Existing
decision thresholds and weights are unchanged.

## API

Employer-admin authentication and trusted-origin checks apply.

- `GET /api/employer/payroll/salary-slips?employeeMappingId=<uuid>&periodStart=<date>&periodEnd=<date>`
  retrieves and synchronizes the minimal projection.
- `POST /api/employer/payroll/salary-slips` with the same three fields creates
  one draft after employee, employment-date, effective-assignment, and duplicate
  validation.

Draft, submitted, and cancelled correspond to Frappe `docstatus` 0, 1, and 2.
The list excludes cancelled slips. The creation endpoint rejects an existing
draft or submitted slip for the exact employee and period.

## Safe diagnostics and staging acceptance

Run `npm run diagnose:erpnext-payroll`. It performs GET-only permission probes,
prints HTTP statuses and configuration presence, and never prints hostnames,
credentials, employee identifiers, or salary values.

On a synthetic staging employee, verify:

1. Correctly configured Employee and assignment produce one calculated draft.
2. Missing assignment returns `SALARY_STRUCTURE_ASSIGNMENT_REQUIRED`.
3. Retrieval returns only the documented projection.
4. A repeated create returns `SALARY_SLIP_ALREADY_EXISTS`.
5. Another organization's mapping returns 404.
6. Missing/stale/cancelled evidence leaves income unavailable and requires
   manual review.
7. Employee users and unauthenticated callers cannot use employer endpoints.
8. No Salary Slip is submitted or cancelled during testing.

Production sign-off requires running these checks against the actual configured
Frappe site and reviewing its Error Log. Automated tests use synthetic responses
and are not proof that production payroll is configured.

## Upstream references

- Frappe REST document lifecycle: https://docs.frappe.io/framework/user/en/api/rest
- Frappe HR payroll setup: https://docs.frappe.io/hr/payroll-setup
- Frappe HR branch compatibility: https://github.com/frappe/hrms/wiki/Changes-to-branching-and-versioning
