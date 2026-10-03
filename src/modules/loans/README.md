# Loans

Funded offers are accepted on Arc through `EmployeeLendingEscrow.acceptOffer`.
The contract atomically consumes the offer, creates an active on-chain loan,
updates reserved principal, and transfers USDC to the borrower. A failed token
transfer reverts the entire transition, and an offer can be consumed only once.

Acceptance also requires a short-lived EIP-712 authorization from the
server-side platform authorizer. It binds the offer, Circle smart-account
borrower, expiry, one-time authorization ID, Arc chain, and deployed contract.
The contract derives the borrower from `msg.sender`, verifies the signature,
and rejects expired or consumed authorizations.

The application creates a `REQUESTED` intent after enforcing authenticated
same-organization membership, employment state, wallet ownership, policy, and
on-chain offer availability. It changes the application loan to `ACTIVE` only
after verifying the `LoanStarted` receipt and current contract loan state.

Interest is applied once for the complete term. Both Solidity and TypeScript
round a positive fractional interest amount up to the nearest USDC base unit.
The due time is calculated by the contract from `block.timestamp + duration`;
the client cannot supply it.

The repository still contains earlier internal-ledger lifecycle code for legacy
records. New on-chain loans use the full receipt-verified repayment flow.
