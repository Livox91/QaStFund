# Arc Testnet deployment and pilot preflight

The application uses the existing Hardhat deployment path. Do not introduce a
second deployment mechanism.

1. Initialize dedicated local-only keys and secrets:

   ```shell
   npm run pilot:configure-secrets
   ```

2. Fund only the printed deployment wallet with the minimum Arc Testnet USDC
   required for contract deployment. Never commit or print the private key.

3. Compile, test, and deploy:

   ```shell
   npm run contracts:compile
   npm run test:contracts
   npm run contracts:deploy:arc
   ```

4. Copy the emitted public contract address, deployment block, and transaction
   hash into `.env`. Set `ARC_RECONCILIATION_ENABLED="true"` and use the
   deployment block as `ARC_RECONCILIATION_START_BLOCK`.

5. Sign in as the first eligible employee over HTTPS (or localhost), open the
   onboarding page, and select **Set up wallet** for a first-time user or
   **Reconnect existing wallet** for a returning user. Complete Circle passkey
   login and approve the ownership-message signature. Confirm the UI reports an
   active wallet and record only its public address. Sign out, then repeat with
   a second employee account and a separate passkey. The users and public wallet
   addresses must both be distinct. Do not insert or update wallet rows manually;
   the consumed challenge is the ownership evidence. A wallet is user-owned and
   survives organization changes; each new organization records its own
   membership-bound proof without replacing the address.

6. Fund both public addresses outside the application with the minimum intended
   Arc Testnet pilot amount. Each wallet needs at least `0.01` ERC-20 USDC for
   the preflight readiness floor and a non-zero Arc native USDC balance for gas.
   The actual pilot amount must cover the chosen lender principal and the
   borrower's full principal-plus-interest repayment; the readiness floor alone
   does not prove that a larger pilot amount is funded. Use only a testnet faucet
   or an operator-controlled testnet funding wallet and verify the destination
   address before submitting that separate manual funding transaction.

7. Run one explicit reconciliation pass after reviewing its database-write
   behavior, then run the non-transactional preflight:

   ```shell
   npm run reconcile:arc
   npm run pilot:preflight
   ```

8. Configure automatic reconciliation in `deploy/.env.production`:

   ```dotenv
   ARC_RECONCILIATION_ENABLED="true"
   ARC_RECONCILIATION_INTERVAL_SECONDS="60"
   ARC_RECONCILIATION_CRON_SECRET="a-dedicated-random-value-of-at-least-32-characters"
   OPERATIONAL_HEALTH_SECRET="a-third-random-value-of-at-least-32-characters"
   OPERATIONAL_ALERT_WEBHOOK_URL="https://alerts.example.com/arc"
   OPERATIONAL_ALERT_WEBHOOK_BEARER_TOKEN="a-dedicated-receiver-token"
   ERP_NEXT_SYNC_ENABLED="true"
   ERP_NEXT_SYNC_INTERVAL_MINUTES="1440"
   ERP_NEXT_ELIGIBILITY_MAX_AGE_MINUTES="1500"
   ERP_NEXT_SYNC_CRON_SECRET="a-separate-random-value-of-at-least-32-characters"
   ```

   The webhook settings are optional. Without them, transition and recovery
   alerts remain available in structured application and scheduler logs.

9. Apply migrations and start the application plus internal scheduler:

   ```shell
   docker compose -f compose.production.yaml --env-file deploy/.env.production --profile tools run --rm migrate
   docker compose -f compose.production.yaml --env-file deploy/.env.production up -d --build app reconciliation-scheduler caddy
   ```

10. Verify deployment without submitting a blockchain transaction:

    ```shell
    docker compose -f compose.production.yaml --env-file deploy/.env.production ps
    docker compose -f compose.production.yaml --env-file deploy/.env.production logs --since=5m reconciliation-scheduler app
    curl --fail --header "Authorization: Bearer ${OPERATIONAL_HEALTH_SECRET}" https://YOUR_DOMAIN/api/health/dependencies
    ```

    Retain evidence that scheduler logs show repeated `COMPLETED` passes,
    `remainingBacklogBlocks` stays within the configured range, cursor blocks
    advance in dependency health, and no unmatched/conflicting count increases.
    Also retain one `ERPNext scheduler response received` entry with zero partial
    and failed runs, a new `SCHEDULED/SUCCESS` database run, and dependency
    health with zero incomplete and stale integrations. Before deployment, run
    `npm run verify:erpnext-source` and `npm run verify:email-provider`; both
    must pass without emitting employee details or credentials.

### Restart, stale-alert, and recovery verification

Perform this only in the testnet deployment:

1. Record the cursor, finalized head, and alert state from dependency health.
2. Restart `reconciliation-scheduler`; verify the next pass resumes the same
   persisted cursor and rechecks the configured reorg window.
3. Stop only the scheduler long enough to exceed the configured stale time or
   block window. Confirm dependency health reports `stale`.
4. Start the scheduler. Confirm one stale transition, bounded catch-up with
   explicit remaining backlog, one `HEALTHY` recovery, and no duplicate
   financial or audit records.
5. Point the scheduler at an unavailable internal endpoint in a controlled
   test deployment or stop `app`; after the configured failure threshold,
   verify one scheduler-endpoint alert. Restore the app and verify one recovery.
6. Run `npm run audit:arc` and `npm run pilot:preflight` from an operator host.

If backlog remains above one configured block range, keep the pilot paused and
allow subsequent bounded passes to continue. Do not increase range limits
without reviewing RPC and execution-time impact. For manual recovery, run
`npm run reconcile:arc` repeatedly until `remainingBacklogBlocks` is within the
health window, then rerun the audit and preflight.

The command fails unless Arc RPC, canonical USDC, escrow bytecode and constructor
bindings, borrow-authorizer matching, a healthy persisted reconciliation
cursor, Circle configuration, two distinct ownership-verified wallets, their
ERC-20 USDC and native fee balances, fresh ERPNext state with scheduling
enabled, rate-limit secret, and the database are all verified. The preflight does not run the
reconciliation worker, create offers, accept loans, repay loans, or move funds.
