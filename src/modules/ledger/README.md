# Ledger

Owns immutable financial recording. The first implementation records each
mock loan disbursement as a transaction with an equal borrower debit and lender
credit. It does not move USDC or call an external settlement provider.

Manual repayments add the inverse balanced pair: borrower cash is credited and
lender cash is debited. Disbursement and repayment transactions link back to
their loan, while repayment transactions also link to the exact repayment.
