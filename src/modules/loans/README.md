# Loans

Funded offers are accepted on Arc through `EmployeeLendingEscrow.acceptOffer`.
The contract atomically consumes the offer, creates an active on-chain loan,
updates reserved principal, and transfers USDC to the borrower. A failed token
transfer reverts the entire transition, and an offer can be consumed only once.

The application creates a `REQUESTED` intent after enforcing authenticated
same-organization membership, employment state, wallet ownership, policy, and
on-chain offer availability. It changes the application loan to `ACTIVE` only
after verifying the `LoanStarted` receipt and current contract loan state.

Interest is applied once for the complete term. Both Solidity and TypeScript
round a positive fractional interest amount up to the nearest USDC base unit.
The due time is calculated by the contract from `block.timestamp + duration`;
the client cannot supply it.

The repository still contains earlier internal-ledger repayment and lifecycle
code. This borrower milestone does not extend or invoke repayment on-chain.
