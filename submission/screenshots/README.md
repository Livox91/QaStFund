# Genuine screenshot capture checklist

Automated browser control was unavailable during this milestone, so no
screenshots were fabricated. Capture these screens manually from the verified
local application at `http://localhost:3000` after running `npm run demo:start`
and `npm run demo:data -- --check`.

Save PNG files using these exact names:

1. `01-employee-dashboard.png` — Alice's `/app` dashboard; crop browser account
   chrome and confirm no cookie, extension, or credential overlay is visible.
2. `02-lender-offers.png` — `/app/lending`, showing offer total, accepted,
   available, disbursed, outstanding, and repaid columns.
3. `03-repayment-schedule.png` —
   `/app/loans/22000000-0000-4000-8000-000000000001`, showing the installment
   schedule and repayment progress.
4. `04-erpnext-integration.png` — `/employer/integrations`, showing the local
   placeholder/fixture state; do not expose a real ERPNext URL or employee data.
5. `05-payroll-proposal.png` — `/employer/payroll`, showing `PROPOSED` and
   `NOT_RECORDED`. Caption it “Local proposal fixture—not an ERPNext deduction.”
6. `06-repayment-exception.png` — `/employer/delinquency`, showing the separate
   partially paid overdue fixture.
7. `07-monitoring.png` — `/employer/monitoring`, with only sanitized operational
   state visible.

Before saving each image, inspect it at full resolution for personal data,
wallet credentials, API keys, private addresses not approved for evidence,
session cookies, password-manager overlays, terminal history, and notifications.
Do not capture wallet/passkey prompts or `.env` files.

After capture, update `submission/PRESENTATION.md` with the corresponding image
links and visually inspect every rendered image. Until then, the presentation
references this checklist instead of claiming screenshots exist.
