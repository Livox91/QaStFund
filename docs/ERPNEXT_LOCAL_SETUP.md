# Local ERPNext connection setup

The “organization secret reference” is internal application metadata, not an
ERPNext setting. Employers no longer enter it. The application generates an
opaque reference and stores it on `EmployeeDirectoryIntegration`; the actual
credential is AES-256-GCM encrypted in a separate table with organization and
authentication method bound as authenticated data.

## One-time application setup

Generate a 32-byte encryption key:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Add the generated value to the local `.env` without committing it:

```dotenv
ERP_NEXT_CREDENTIAL_ENCRYPTION_KEY="generated-base64-value"
ERP_NEXT_ALLOW_LOCAL_HTTP="true"
```

Keep the encryption key stable. If it is lost or changed, previously saved
credentials cannot be decrypted and must be entered again. Local HTTP is
accepted only for loopback hosts when the development opt-in is enabled;
production ERPNext URLs must use HTTPS and pass the application's SSRF checks.

Apply the database migration and start the application:

```powershell
npm run prisma:deploy
npm run dev
```

`ERP_NEXT_CREDENTIALS_JSON` is not required for the UI-managed local flow. It
remains available only for legacy/operator-managed integrations.

## ERPNext setup

Create a dedicated ERPNext integration user and grant it read-only access to
the `Employee` DocType. Do not use Administrator and do not grant write access.
Generate that user's API key and API secret in ERPNext. The API secret is shown
for provisioning and should be handled as a password.

Ensure ERPNext employee records have stable IDs (`name`) and, where matching is
expected, email addresses equal to existing P2P Lending employee accounts.

## Connect and verify

1. Sign in to P2P Lending as the employer administrator.
2. If ERPNext is disabled, open Employer Dashboard → Onboarding and enable it.
3. Open Employer Dashboard → Integrations → ERPNext.
4. Enter the local ERPNext base URL, normally `http://localhost:<port>` when
   both applications run on the host. If either application runs in a
   container, use an address reachable from that application's runtime.
5. Keep `/api/resource`, API version `v1`, and API token authentication unless
   the ERPNext installation requires another supported setting.
6. Enter the dedicated user's API key and API secret, review the status
   mappings, and select **Save configuration**.
7. Select **Test connection**. The status should become `connected`.
8. Select **Sync employees**. Confirm the processed count and review any
   unmatched records.
9. Open Employer Dashboard → Employees and verify matched employees appear with
   the expected employment status. Unmatched ERPNext records remain in the
   integration page's review section; the sync does not create login users.

Saved pages and action responses contain only connection status and sanitized
errors. They never contain the API secret, decrypted credential, authorization
header, or encrypted payload.
