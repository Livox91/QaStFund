# ERPNext payroll integration

The implementation lives in `src/modules/payroll-integration`. It uses
Frappe's standard document REST API and a payroll-specific service identity.
It can validate prerequisites, retrieve a minimal Salary Slip projection, and
create **draft** Salary Slips. QastFund never submits, cancels, amends, deletes,
or directly inserts payroll records.

See `docs/ERPNEXT_PAYROLL_INTEGRATION.md` for configuration, permissions,
mapping, API contracts, and the staging acceptance checklist.
