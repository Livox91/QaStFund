# Auth

Owns local credential verification, opaque database sessions, authenticated actor resolution, and server-side guards.

The MVP adapter uses scrypt password hashes and organization-scoped sessions. Public registration atomically creates a new organization, its first `EMPLOYER_ADMIN` membership, and a session; it never permits a caller to self-select an existing organization or role. ERPNext-synchronized employees receive an organization-scoped, expiring invitation and remain unable to authenticate until they accept it and create a password. Invitation and password-reset tokens are random, stored only as hashes, expire, and are single-use. SSO, MFA, and organization switching remain out of scope. A future OIDC adapter should replace credential verification without changing application roles or membership-based authorization.

Employees can change their password from `/profile`; the current session is retained and their other sessions are revoked. `/forgot-password` always returns the same public response, whether or not the submitted email is eligible, and a successful reset revokes every existing session.

JSON endpoints are available at `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, and `GET /auth/me`. Organization identity and membership are available from `GET /organization/me`; only employer administrators may call `GET /organization/members`.

Reusable application policies are exposed from `application/authorization.ts`: `requireAuthenticatedUser`, `requireEmployerAdmin`, `requireEmployee`, and `requireOrganizationAccess`. Call them only with an actor resolved from the server-side database session. Tenant-owned repositories must additionally require `organizationId` in every lookup; an ID from a request is never sufficient by itself.
