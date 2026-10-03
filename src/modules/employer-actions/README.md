# Employer action integration boundary

`EmployerActionAdapter` is the only boundary through which an authorized,
explicit employer request may reach an external HR system. The decision engine
only recommends actions and never invokes this adapter.

The current `mock` provider is side-effect free. Its action IDs and results are
deterministic from the request, and its message codes explicitly say that no
email, HR request, payroll change, wallet operation, or financial enforcement
occurred.

## Future ERPNext adapter

A future ERPNext implementation must remain disabled unless explicitly selected
and fully configured. It should:

1. Authenticate with a dedicated, least-privilege service account. Credentials
   must stay in server-side secret storage and must never enter action results,
   audit rows, URLs, or logs.
2. Resolve internal organization and employee IDs through an explicit mapping
   table. An ERPNext employee record alone does not grant payroll or deduction
   authority.
3. Send only data required for the approved workflow. Loan balances and decision
   classifications must not be shared by default.
4. Use the internal idempotency key as an external request key when supported,
   and persist the returned external request ID separately from credentials.
5. Apply bounded timeouts and retry only failed requests with a new internal
   attempt or a provider-supported idempotent retry. Never duplicate an external
   operation after an ambiguous timeout.
6. Normalize provider responses into `EmployerActionResult`, use safe message
   codes for the UI, and retain detailed provider errors only in access-controlled
   operational telemetry.
7. Treat service outages as `failed` or `pending`; they must never change loan,
   wallet, on-chain, payroll, or decision state.

Any salary deduction or payroll enforcement requires a separate design with
employee consent, legal review, granular authorization, and provider-specific
integration tests. It is not part of this adapter.
