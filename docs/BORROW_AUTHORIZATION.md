# Borrow authorization and escrow deployment

`EmployeeLendingEscrow` keeps offers open to eligible employees while rejecting
arbitrary callers. Before an acceptance transaction, the authenticated server
re-checks the employee, organization, employment status, lending policy, Arc
wallet, and live offer. It then signs a five-minute EIP-712 authorization.

The signed `BorrowAuthorization` contains:

- the exact chain offer ID;
- the borrower's Circle smart-account address;
- an expiry timestamp; and
- a one-time authorization ID derived from the application's borrow request ID.

The EIP-712 domain adds chain ID and verifying-contract address. The contract
derives the borrower from `msg.sender`, which is the Circle smart account that
receives the escrowed USDC. It rejects signatures from any other caller,
expired authorizations, and reused authorization IDs.

## Trust and key management

The platform service is the authorizer because the current product has one
server-side policy boundary and employers do not have on-chain administrative
keys. A compromised authorizer key could approve an attacker-controlled wallet
for any active offer, so production deployments must keep the key in a managed
signing service or secret store with access logging and rotation procedures.

Configure the application with the server-only
`ARC_BORROW_AUTHORIZER_PRIVATE_KEY`. Never prefix this variable with
`NEXT_PUBLIC_`, return it from an API, log it, or store it in PostgreSQL.

Set `ARC_BORROW_AUTHORIZER_ADDRESS` to the corresponding public address only
when deploying. The contract stores that address immutably. Key rotation
therefore requires a replacement contract and migration plan.

## Deployment

This contract version changes both the constructor and `acceptOffer` ABI. It
must be redeployed; offers funded in an older contract are not compatible and
must not be represented as offers in the replacement contract.

1. Generate or provision a dedicated authorization key outside the repository.
2. Set `ARC_BORROW_AUTHORIZER_PRIVATE_KEY` only in the application runtime.
3. Set its public address as `ARC_BORROW_AUTHORIZER_ADDRESS` in the deployment
   environment.
4. Set `ARC_DEPLOYER_PRIVATE_KEY` for the Arc Testnet deployment account.
5. Run `npm run test:contracts` and `npm test`.
6. Deliberately run `npm run contracts:deploy:arc`. The project never deploys
   automatically.
7. Verify the printed contract address and authorization signer against the
   intended values, then set `NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS` to the
   new address and restart/rebuild the application.
8. Fund and accept a new testnet offer with test funds before enabling the
   deployment for users.

Do not overwrite an existing address until outstanding offers and loans on the
old contract have an explicit compatibility or wind-down plan.
