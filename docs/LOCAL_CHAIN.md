# Local Hardhat chain

The local chain is development-only. It uses chain ID `31337`, Hardhat's
well-known deterministic mnemonic, and a token named `Development Mock USDC`
(`mUSDC`). Never use the mnemonic or mock token outside local development.

## Run locally

Prerequisites are installed npm dependencies and a healthy PostgreSQL database
configured through `DATABASE_URL`. Standard application tests are isolated from
the RPC integration and need no Hardhat process:

```bash
npm test
```

Run the complete isolated blockchain integration with:

```bash
npm run chain:test
```

This command selects a free loopback port, starts a fresh Hardhat instance,
deploys both contracts, validates the instance-specific manifest, applies
database migrations, supplies the generated addresses to the tests, executes
the RPC checks and full database-backed lending lifecycle, and stops the node.
It never reads contract addresses from `.env`.

For interactive development, start the managed node:

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
authorization signer to the ignored `deployments/local.json`. Copy its current
values to the local-chain variables in `.env` before starting the application.
The manifest contains the Hardhat instance ID, so tests reject addresses left
over from a previous node.

Use `npm run chain:reset` to restart the managed node with empty state and
immediately redeploy.

If a command reports a stale manifest, run `npm run chain:reset`. If the RPC
port belongs to an unmanaged process, stop that process before using the
managed commands. Node startup logs are in `cache/local-chain/node.log`.

Arc Testnet variables and deployment commands remain separate and unchanged.
