# Send USDC on Arc Testnet

## Architecture

QastFund uses the existing Circle Modular Wallet architecture. The wallet is a
passkey-controlled Modular Smart Contract Account (MSCA); QastFund never
creates, exports, or stores a private key. The installed SDK is
`@circle-fin/modular-wallets-core` 1.0.13. The implementation follows Circle's
[modular-wallet transfer flow](https://developers.circle.com/wallets/modular/transfer-tokens),
not the developer-controlled EOA signing API. The latter is a different wallet
product and would create a second custody architecture.

The application is Next.js 16 App Router. Authenticated route handlers are the
trusted validation and persistence boundary. The browser uses the existing
Circle passkey account only after an explicit review and calls
`sendUserOperation` with one server-generated ERC-20 transfer call. Circle's
Arc Testnet Gas Station sponsorship is enabled with `paymaster: true`; the UI
therefore reports a sponsored fee instead of fabricating an RPC fee estimate.

The immutable `ArcUsdcTransfer` row is the audit record and idempotency guard:

1. `POST /api/wallet/arc/transfers` authenticates the employee, verifies wallet
   ownership, checks the live chain ID, reads the USDC contract decimals and
   balance, creates the exact Circle `encodeTransfer` call, and persists an
   `AWAITING_CONFIRMATION` intent.
2. The review UI displays the full sender, recipient, amount, network, fee
   sponsorship, total, and testnet/irreversibility warnings. No transaction is
   submitted by opening the review.
3. `POST /api/wallet/arc/transfers/:id/authorize` rechecks ownership,
   expiration, Arc configuration, and the current balance immediately before
   signing. It reproduces the immutable call and compares its hash.
4. The user explicitly chooses **Confirm with passkey**. The passkey signs one
   ERC-4337 user operation and Circle's bundler submits it.
5. The browser immediately persists the user-operation hash locally for crash
   recovery and binds it to the intent through the authenticated API. A retry
   only binds or queries the same operation; it never sends a second one.
6. The server obtains or receives the on-chain transaction hash and verifies a
   successful receipt containing exactly one outgoing official-USDC `Transfer`
   from the enrolled wallet, with the approved recipient and amount. Only then
   is the intent `CONFIRMED`.

Lifecycle states are `DRAFT`, `AWAITING_CONFIRMATION`, `SUBMITTED`,
`CONFIRMED`, `FAILED`, and `UNKNOWN`. A timeout without a known operation hash
is conservative `UNKNOWN`; users are told not to retry it as a new transfer.
Known user cancellation is `FAILED/USER_REJECTED`. Status GETs reconcile a
stored Circle user-operation hash and never submit a transaction.

## Verified Arc configuration

The allowlist is compile-time fixed to Arc Testnet:

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.io`
- Explorer: `https://explorer.testnet.arc.io`
- Native gas asset: USDC, 18-decimal native representation
- Transfer interface: `0x3600000000000000000000000000000000000000`
- Transfer decimals: 6

Arc exposes one underlying USDC balance through its native 18-decimal gas
representation and an ERC-20 6-decimal interface. QastFund uses only the
recommended ERC-20 interface for application balances and transfers. See the
official [Arc connection parameters](https://docs.arc.io/arc/references/connect-to-arc)
and [contract-address reference](https://docs.arc.io/arc/references/contract-addresses).
The Circle SDK's `ContractAddress.ArcTestnet_USDC` must match the application
constant or preparation fails closed.

All amounts are converted to integer base units without JavaScript floating
point. The API accepts no caller-provided calldata and rejects unknown JSON
fields, unsupported chains, and alternate token contracts. Mutation routes
enforce same-origin requests, authenticated employee authorization, 4 KiB body
limits, and the shared PostgreSQL-backed sensitive-operation rate limit.

## Configuration and local use

Set the existing placeholders in `.env`; never commit real credentials:

```dotenv
ARC_CHAIN_ID="5042002"
ARC_RPC_URL="https://rpc.testnet.arc.io"
ARC_USDC_ADDRESS="0x3600000000000000000000000000000000000000"
NEXT_PUBLIC_CIRCLE_CLIENT_KEY="<Circle public client key>"
NEXT_PUBLIC_CIRCLE_CLIENT_URL="https://modular-sdk.circle.com/v1/rpc/w3s/buidl"
```

The `NEXT_PUBLIC_` values are Circle's browser client identifiers, not Circle
API keys or entity secrets. Configure `APP_URL`'s hostname as the Passkey Domain
in Circle Console. Run `npm run prisma:deploy` (or `npm run prisma:migrate` in
development), then `npm run dev`. Use localhost or HTTPS because WebAuthn does
not work on an insecure remote origin.

Open the employee dashboard, set up or reconnect the existing wallet, and use
**Send USDC**. Obtain Arc Testnet USDC from the
[Circle Faucet](https://faucet.circle.com). Testnet USDC has no monetary value.

## Testing

The default suite covers strict amount/address/network/token validation,
zero-address and self-transfer handling, decimal precision, arbitrary-calldata
rejection, and exact receipt matching (including rejecting modified amounts or
additional outgoing transfers). Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The live suite validates Circle transport and Arc configuration. A passkey
ceremony requires an interactive secure browser and cannot be honestly
automated by the Node test runner. To exercise the real end-to-end path:

1. Configure a real Circle testnet client and a funded enrolled wallet.
2. Start QastFund on its registered passkey domain.
3. Send a small amount from `/app/wallet/send` and wait for `CONFIRMED`.
4. Put the returned hash, sender, recipient, and integer amount in
   `ARC_SEND_TEST_TRANSACTION_HASH`, `ARC_SEND_TEST_SENDER`,
   `ARC_SEND_TEST_RECIPIENT`, and `ARC_SEND_TEST_AMOUNT_BASE_UNITS`.
5. Run `npm run test:arc-live`. The opt-in test independently verifies the
   successful Arc receipt and exact USDC transfer event.

Do not report a live transfer as successful unless both the UI/API record and
the explorer/verification test confirm it.

## Recovery and limitations

- A browser refresh after submission reads the intent ID from the URL and the
  non-secret user-operation hash from local storage, then resumes binding and
  receipt lookup without resubmission.
- If Circle receipt lookup exceeds its recent-block window, a stored on-chain
  hash remains inspectable and verifiable. Operators should investigate an
  `UNKNOWN` record before allowing a replacement transfer.
- Incoming activity is not yet indexed into the application transfer table;
  the wallet card shows recent application-originated outgoing transfers and
  links to the Arc explorer.
- Passkey recovery must be configured for production-like pilots. Losing every
  passkey/recovery credential can make a self-custodial modular wallet
  unrecoverable.
- The server approval is an application control, not an installed on-chain
  wallet policy module. A wallet owner can use their passkey through other
  compatible software. QastFund never records such activity as an approved
  application transfer. Adding an audited ERC-6900 policy module would be
  required to enforce an allowlist on every operation at the wallet contract.
- Testnet sponsorship is automatic according to Circle's current documentation.
  Mainnet is intentionally unsupported. A future non-sponsored mode must add
  explicit native-gas fee reservation and must not reuse the Max behavior.
