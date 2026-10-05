# Local Hardhat chain

The local chain is development-only. It uses chain ID `31337`, Hardhat's
well-known deterministic mnemonic, and a token named `Development Mock USDC`
(`mUSDC`). Never use the mnemonic or mock token outside local development.

## Run locally

```bash
npm run chain:start
```

The managed node runs in the background. Its process ID and log are stored
under the ignored `cache/local-chain` directory. Stop it with
`npm run chain:stop`.

Deploy with:

```bash
npm run chain:deploy
```

The deployment command mints 1,000,000 mock USDC (6 decimals) to the deployer,
lender, and borrower development accounts. It writes all addresses and the
authorization signer to `deployments/local.json`. Copy the manifest values to
the generic blockchain variables in `.env` before starting the application.

Use `npm run chain:reset` to restart the managed node with empty state and
immediately redeploy. Run `npm run chain:test` for a self-contained check;
it starts an isolated node on a free port, deploys, verifies the backend read
client, and stops the node.

Arc Testnet variables and deployment commands remain separate and unchanged.
