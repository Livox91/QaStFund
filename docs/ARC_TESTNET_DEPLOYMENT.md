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

The command fails unless Arc RPC, canonical USDC, escrow bytecode and constructor
bindings, borrow-authorizer matching, a healthy persisted reconciliation
cursor, Circle configuration, two distinct ownership-verified wallets, their
ERC-20 USDC and native fee balances, explicit ERPNext disablement, rate-limit
secret, and the database are all verified. The preflight does not run the
reconciliation worker, create offers, accept loans, repay loans, or move funds.
