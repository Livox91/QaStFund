# Rate limiting and abuse protection

This is an internal operator guide. Do not publish pilot thresholds in the
public application UI.

## Architecture

Rate limits use fixed windows stored in PostgreSQL. The counter update is an
atomic upsert, so concurrent requests and multiple application instances share
one result. Identities are stored as keyed HMAC hashes; raw IP addresses,
emails, session tokens, and user IDs are not stored in rate-limit buckets or
written to rate-limit logs. Expired rows are removed incrementally while new
requests are consumed.

Rate limiting is an additional request boundary. Existing authentication,
role checks, tenant scoping, transaction handling, and idempotency constraints
still make the authorization and financial decisions.

## Protected categories

The default window is five minutes.

| Category       | Default | Identity                | Operations                                                                                                                                |
| -------------- | ------: | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Login account  |       5 | normalized email HMAC   | JSON and browser-form login                                                                                                               |
| Public/auth IP |      20 | client IP HMAC          | login IP guard and registration                                                                                                           |
| Sensitive      |      10 | authenticated user HMAC | wallet enrollment/challenges, offer funding and confirmation, offer acceptance/status, repayment intent/confirmation, development funding |
| Administrative |      20 | authenticated user HMAC | lending policy, employee access, employer loan actions, integration configuration                                                         |
| Expensive      |      10 | authenticated user HMAC | borrow quotes, loan decision/review evaluation, ERPNext connection tests and manual sync                                                  |

Buckets are also separated by action, so exhausting a quote limit does not
consume a repayment-confirmation limit. Authenticated operations never use IP
as their sole identity. Unauthenticated, read-only health and public content
remain outside the limiter; authenticated low-risk reads continue to rely on
session and authorization controls.

## Configuration

The `.env.example` file lists every setting:

- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_HASH_SECRET`
- `RATE_LIMIT_TRUST_PROXY`
- `RATE_LIMIT_TRUSTED_PROXY_HOPS`
- `RATE_LIMIT_WINDOW_SECONDS`
- `RATE_LIMIT_AUTH_MAX`
- `RATE_LIMIT_PUBLIC_MAX`
- `RATE_LIMIT_SENSITIVE_MAX`
- `RATE_LIMIT_ADMIN_MAX`
- `RATE_LIMIT_EXPENSIVE_MAX`

For a pilot, change category limits conservatively and keep the same values on
every instance. Configure a dedicated random `RATE_LIMIT_HASH_SECRET` of at
least 32 characters. Local development falls back to `DATABASE_URL` as the HMAC
key, but deployed environments should not rely on that fallback.

Forwarded IP headers are ignored by default. Enable `RATE_LIMIT_TRUST_PROXY`
only when the application is reachable exclusively through a controlled
reverse proxy, and set `RATE_LIMIT_TRUSTED_PROXY_HOPS` to the exact proxy-chain
depth. A deployment without trusted client-address metadata deliberately uses
one unattributed public bucket.

## Responses and investigation

Limited API requests return HTTP `429`, error code `RATE_LIMITED`, a
`Retry-After` header, and `retryAfterSeconds` in the error body. Fixed windows
expire automatically, so a small burst cannot permanently lock out a user.

Structured warning logs contain only the action, identity scope, a short HMAC
fingerprint, and retry delay. Investigators can correlate repeated fingerprints
and actions without accessing raw credentials or request bodies. Database
records can be grouped by `action` and `expiresAt`; `identityHash` is not a user
identifier and should not be exposed externally.

The limiter fails closed when PostgreSQL is unavailable. This is consistent
with the protected workflows, which already require PostgreSQL. Monitor bucket
growth and migration health through the existing operational database tooling;
the request path removes expired rows in bounded batches.
