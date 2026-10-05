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

5. Enroll two separate pilot users through the real Circle passkey wallet flow.
   They must produce distinct active wallet addresses.

6. Run the no-funds preflight:

   ```shell
   npm run pilot:preflight
   ```

The command fails unless Arc RPC, canonical USDC, escrow bytecode and constructor
bindings, borrow-authorizer matching, reconciliation, Circle configuration and
two distinct wallets, explicit ERPNext disablement, rate-limit secret, and the
database are all verified. It does not create offers, accept loans, repay loans,
or move funds.
