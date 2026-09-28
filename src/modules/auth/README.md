# Auth

Owns local credential verification, opaque database sessions, authenticated actor resolution, and server-side guards.

The MVP adapter uses scrypt password hashes and organization-scoped sessions. Public registration atomically creates a new organization, its first `EMPLOYER_ADMIN` membership, and a session; it never permits a caller to self-select an existing organization or role. Password reset, SSO, MFA, invitations, and organization switching remain out of scope. A future OIDC adapter should replace credential verification without changing application roles or membership-based authorization.

JSON endpoints are available at `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, and `GET /auth/me`. Organization identity and membership are available from `GET /organization/me`; only employer administrators may call `GET /organization/members`.

Reusable application policies are exposed from `application/authorization.ts`: `requireAuthenticatedUser`, `requireEmployerAdmin`, `requireEmployee`, and `requireOrganizationAccess`. Call them only with an actor resolved from the server-side database session. Tenant-owned repositories must additionally require `organizationId` in every lookup; an ID from a request is never sufficient by itself.
