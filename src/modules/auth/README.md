# Auth

Owns local credential verification, opaque database sessions, authenticated actor resolution, and server-side guards.

The MVP adapter uses scrypt password hashes and organization-scoped sessions. Registration, password reset, SSO, MFA, invitations, and organization switching are intentionally out of scope. A future OIDC adapter should replace credential verification without changing application roles or membership-based authorization.

Reusable application policies are exposed from `application/authorization.ts`: `requireAuthenticatedUser`, `requireEmployerAdmin`, `requireEmployee`, and `requireOrganizationAccess`. Call them only with an actor resolved from the server-side database session. Tenant-owned repositories must additionally require `organizationId` in every lookup; an ID from a request is never sufficient by itself.
