# Employer onboarding

The employer setup page is available at `/employer/onboarding`. Employer registration remains the only organization-creation path: it atomically creates one organization, the employer administrator membership, and the initial session. The onboarding page initializes and configures that existing tenant; it never accepts an organization ID from a form.

## Setup flow

An authenticated employer administrator can:

- update the current organization's display name;
- save the existing lending-policy fields and defaults;
- enable or disable ERPNext for the current organization;
- open the existing ERPNext configuration page;
- invoke the existing employee synchronization service for an initial import; and
- review the latest sanitized synchronization result and setup checklist.

The informational checklist derives its state from PostgreSQL and validated server configuration. Pilot readiness requires a valid organization profile, an active employer administrator, at least one employee membership, an explicitly saved lending policy, valid Arc testnet configuration, and a connected ERPNext integration only when ERPNext is enabled.

ERPNext enablement is stored on `Organization.erpNextEnabled`. Scheduled synchronization selects only organizations where this flag is true. Disabling it stops future scheduled selection without deleting integration configuration, mappings, employees, or sync history.

## Authorization and financial safety

The employer route layout and every Server Action require an authenticated employer administrator. Application services derive organization scope from the authenticated actor. The onboarding repository independently checks an active employer-admin membership before every read or update, and update predicates remain organization-scoped. No form accepts an organization, membership, employee, policy, or integration ID.

Policy updates reuse the existing policy schema, domain validation, organization-scoped transaction, version increment, and audit event. They do not rewrite existing loans, repayments, offers, or balances.

Initial employee import reuses the existing ERPNext synchronization service. It is available only when ERPNext is enabled and an integration exists. The integration is read-only and does not create application login identities from unmatched ERPNext records; those records remain available for review.

## Verification

The following commands require Docker PostgreSQL and were used for this milestone:

```powershell
docker compose up -d postgres
npm run prisma:deploy
npm test -- tests/employer-onboarding.test.ts tests/employer-onboarding-database.test.ts tests/erpnext-employee-directory.test.ts tests/erpnext-employee-directory-database.test.ts
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run prisma:status
```

Tests cover incomplete and complete readiness, ERPNext enabled and disabled states, initial synchronization delegation, invalid policy values, duplicate registration rollback, organization-scoped updates, cross-organization rejection, scheduled-sync enablement, expired sessions, and logout revocation.

Last verified on 2026-10-04 with Docker PostgreSQL: all 30 migrations were current; 279 tests passed across 43 files with one intentional skip; type checking, ESLint, formatting, and the Next.js production build passed.
