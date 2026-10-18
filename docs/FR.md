For QastFund, the main functional requirements should describe what the system must do to enable employees to borrow from a shared pool of funds contributed by other employees within the same organization, with employer-integrated payroll, blockchain-based transactions, and an automated loan repayment agent.

# QastFund — Main Functional Requirements

## 1. User and role management

The system must support different user roles with appropriate permissions.

- Employee / Borrower: Requests loans, accepts loan terms, receives funds, and repays loans.
- Employee / Lender: Contributes available funds and tracks lending activity, repayments, and returns.
- Employer / HR / Payroll: Manages employees, verifies employment and salary data, and handles repayment exceptions.
- Administrator: Manages platform configuration, permissions, risk policies, and system monitoring.
- Repayment Agent: Monitors repayment obligations, executes authorized repayment workflows, and escalates overdue loans.

An employee may act as both a lender and a borrower.

## 2. Employee financing and loan management

FR-01: Loan application

Employees must be able to request a loan by entering the amount required and selecting a repayment duration.

FR-02: Loan eligibility and decisioning

The system must evaluate requests using configured rules, verified employment information, available lending liquidity, and applicable risk limits. Incomplete data must trigger manual review where required.

FR-03: Partial loan funding

Borrowers must be able to accept less than the requested amount if only part of the request can be funded or if they need a smaller amount.

FR-04: Repayment plan generation

The system must generate repayment schedules for supported terms, such as one, two, or three months, and display installment amounts, due dates, and outstanding balances.

FR-05: Loan lifecycle management

The system must track each loan through statuses such as requested, under review, approved, funded, active, overdue, repaid, rejected, and cancelled.

## 3. Internal peer-to-peer lending marketplace

- FR-06: Lender fund offers: Employees must be able to specify how much money they are willing to lend.
- FR-07: Available liquidity: The system must maintain a record of available, committed, and deployed funds.
- FR-08: Loan matching: The system must match eligible loan requests with available lender contributions.
- FR-09: Partial contribution allocation: Multiple lenders may collectively fund one loan, subject to configured rules.
- FR-10: Lender portfolio: Lenders must be able to view active contributions, outstanding principal, repayments received, and applicable returns.
- FR-11: Fund withdrawal controls: The system must prevent withdrawals of funds that are committed to active loans or otherwise restricted.

The platform should enforce organization-level lending boundaries so that employees participate only in the appropriate internal lending pool.

## 4. Loan repayment agent

This is one of QastFund's most important differentiating features.

- FR-12: Repayment monitoring: The agent must monitor upcoming installments, due dates, payments, and overdue balances.
- FR-13: Authorized repayment execution: The agent must initiate repayments only through approved payment mechanisms and within the borrower's explicit authorization and applicable limits.
- FR-14: Partial repayments: The system must support repayments smaller than the outstanding balance and recalculate the remaining amount.
- FR-15: Failed payment handling: The agent must detect failed or incomplete transactions, record the failure, and follow configured retry rules.
- FR-16: Overdue escalation: If an employee fails to repay, the system must notify the employee and authorized employer representatives according to the organization's policy.
- FR-17: Employer action recommendations: The agent must recommend next steps, such as contacting the employee, reviewing a payroll deduction, or escalating to a designated reviewer. It must not autonomously impose employment penalties.
- FR-18: Repayment reconciliation: Confirmed payments must update the loan balance, lender balances, transaction records, and repayment schedule consistently.

## 5. ERPNext and payroll integration

- FR-19: Employee synchronization: Import or synchronize employee records from ERPNext.
- FR-20: Employment verification: Retrieve relevant employment status, salary, and tenure data where available and authorized.
- FR-21: Payroll integration: Integrate with the employer's payroll workflow to support approved deductions or repayment reconciliation.
- FR-22: Payroll discrepancy handling: Detect discrepancies between scheduled repayments and actual payroll deductions.
- FR-23: Employee status changes: Flag termination, unpaid leave, or other employment changes that could affect repayment, subject to the data available.
- FR-24: Integration reliability: Handle API failures, duplicate events, and synchronization errors without duplicating loan disbursements or repayments.

Payroll deductions must follow applicable law, employer policy, and the employee's valid authorization. The platform should not assume that a salary deduction is available merely because ERPNext is integrated.

## 6. Blockchain and payment processing

QastFund uses Circle wallet infrastructure and Arc for blockchain-based financial operations.

- FR-25: Wallet management: Associate an authorized wallet with each participating user or account.
- FR-26: Loan disbursement: Transfer approved and funded loan amounts to the intended borrower through the configured payment mechanism.
- FR-27: On-chain transaction verification: Verify transaction status, network, token, amount, recipient, and confirmation before marking a transfer as completed.
- FR-28: Loan and payment records: Link relevant on-chain transactions to internal loan and repayment records.
- FR-29: Transaction safety: Prevent duplicate transactions, unauthorized transfers, and invalid state transitions.
- FR-30: Transaction history: Display transaction references, amounts, timestamps, and statuses.
- FR-31: Failed and pending transactions: Support pending, failed, and reconciled states without incorrectly updating financial balances.

Blockchain transactions should be treated as confirmed only after the required verification. Smart contracts and internal accounting must remain consistent.

## 7. Notifications and reporting

- FR-32: Automated notifications: Notify users about loan decisions, funding, upcoming installments, successful payments, failed payments, and overdue balances.
- FR-33: Employer dashboard: Show relevant lending activity, repayment exceptions, payroll discrepancies, and outstanding loans.
- FR-34: Employee dashboard: Display loan applications, available lending funds, active loans, repayment schedules, and transaction history.
- FR-35: Audit reports: Generate records of loan decisions, user approvals, repayment actions, administrative changes, and financial transactions.
- FR-36: Portfolio reporting: Provide aggregated information about lending pool utilization, outstanding principal, overdue loans, and repayment performance.

## 8. Security, permissions, and compliance

These requirements are essential before real money is involved.

- FR-37: Authentication: Require secure user authentication and appropriate session management.
- FR-38: Role-based access control: Restrict employee, lender, employer, administrator, and agent permissions.
- FR-39: Consent management: Record borrower authorization for loan terms, payment execution, and any permitted payroll deductions.
- FR-40: Auditability: Maintain tamper-resistant records of financial actions and important changes.
- FR-41: Key management: Protect signing credentials and wallet authorization keys using appropriate managed custody and access controls.
- FR-42: Data protection: Protect employee salary, employment, identity, and financial information.
- FR-43: Risk and policy controls: Enforce configured borrowing limits, funding limits, repayment constraints, and manual-review requirements.
- FR-44: Compliance controls: Support applicable identity verification, lending, employment, privacy, and financial regulations for the deployment jurisdiction.

## End-to-end functional workflow

1\. Employee onboarding

Authenticate and synchronize authorized employment data from ERPNext

2\. Loan request and decision

Validate eligibility, amount, repayment duration, and applicable limits

3\. Internal lender matching

Allocate available lender funds, including partial contributions

4\. Loan agreement and disbursement

Record acceptance, execute authorized transfer, and verify settlement

5\. Repayment agent

Monitor installments, initiate authorized repayments, and reconcile transactions

6\. Completion or escalation

Distribute repayments, update balances, and notify relevant parties about exceptions

## Recommended MVP priorities

Not every requirement needs to be implemented at once. For the first usable QastFund pilot, I would prioritize the following:

| Priority | Functional area                    | MVP outcome                                                                                |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| P0       | User roles and onboarding          | Employees and administrators can use the platform securely                                 |
| P0       | Loan management                    | Requests, decisions, terms, and loan statuses work end to end                              |
| P0       | Lending marketplace                | Contributions, partial funding, and available liquidity are tracked                        |
| P0       | Repayment agent                    | Installments, authorized repayment execution, failure handling, and escalation work        |
| P0       | ERPNext integration                | Employee and payroll-related data synchronize reliably                                     |
| P0       | Circle and Arc integration         | Testnet transfers and transaction verification work                                        |
| P0       | Financial reconciliation           | Internal balances match confirmed transactions                                             |
| P1       | Notifications and reporting        | Employees and employers receive relevant updates                                           |
| P1       | Advanced risk scoring              | Additional decision support after data quality and validation are established              |
| P1       | Production security and compliance | Managed key custody, operational controls, and deployment-specific compliance are verified |

Important distinction: passing testnet transactions and implementing a repayment agent do not, by themselves, make the platform production-ready. Real-money lending also requires verified payment authorization, reliable reconciliation, secure key management, and appropriate legal and operational controls.

The core functional objective of QastFund is to connect employees who have available lending capital with employees who need short-term financing, while automating the loan lifecycle from eligibility and funding through repayment and exception management.