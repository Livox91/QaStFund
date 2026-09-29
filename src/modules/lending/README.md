# Lending

Funded offers are created through `EmployeeLendingEscrow` on Arc Testnet. The
application stores a pending intent for UI/querying, but only marks an offer
`FUNDED` and `ACTIVE` after verifying its `OfferCreated` receipt. Historical
database-only offers remain `LEGACY` and are not eligible for the marketplace.

Marketplace queries are scoped by the authenticated employee's organization,
exclude that employee's own offers, and return only funded, active, unexpired
offers. Organization membership is an MVP application-layer rule; it is not
encoded in the public smart contract.
