# Repayment agent

Status: implemented and tested locally (Hardhat + PostgreSQL). Not yet deployed
to Arc Testnet; deployment steps are below.

The repayment agent decides **when** and **how much** a borrower repays,
executes the repayment inside limits the borrower signed on-chain, verifies the
result, adapts when conditions change, and explains every decision.

Credit approval is deliberately **not** agentic. Origination keeps its
deterministic rules and human review. Agency is applied after the loan exists,
to repayment and liquidity management, where the borrower's own signed mandate
bounds every action.

## The loop

```text
Observe  → wallet balance and allowance, on-chain mandate, obligations and
           on-chain repaid amounts, reconciliation health, in-flight payments,
           open approval requests, recent payments and failures
Reason   → the planner (OpenAI model, or deterministic rules) calls read-only
           tools and proposes one action with reasons and rejected alternatives
Validate → deterministic policy checks; rejected plans are fed back for a
           replan, and repeated rejection escalates with no funds moved
Act      → re-check against live state, create an intent, simulate on-chain,
           sign → persist hash → broadcast repayOnBehalf
Verify   → receipt status, exactly one repayment event, the agent event, exactly
           one USDC transfer borrower → lender, contract state
Adapt    → monitor pending payments instead of resubmitting; retry transient
           failures with the same repayment id; replan after deterministic
           failures or an unexpected balance change; stop on repeated failure
Explain  → every step is persisted in an append-only activity log
```

Up to three actions run per cycle, so a cycle can pay one obligation, notice the
borrower spent money, and re-plan the next obligation.

## Three layers of enforcement

| Layer                                                                                                     | What it enforces                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planner (model or rules)                                                                                  | Chooses among `PAY_FULL`, `PAY_PARTIAL`, `WAIT`, `NOTIFY_USER`, `REQUEST_APPROVAL`, `ESCALATE` and `STOP`, using pseudonymous loan references (`L1`, `L2`). It has no access to addresses, calldata or identities.                                                                                                                                                                                                                                   |
| Validator ([`validate-agent-plan.ts`](../src/modules/repayment-agent/application/validate-agent-plan.ts)) | Strict schema (no extra fields); the loan belongs to this borrower; contract allowlist; reconciliation healthy; nothing in flight; mandate active; per-repayment cap; period cap; minimum reserve; allowance; due-date window; payment spacing; whole cents; reason codes consistent with the action; the explanation states the amount; rejected alternatives distinct. It runs twice: on the plan, then against fresh state just before execution. |
| Contract ([`EmployeeLendingEscrowV3.sol`](../contracts/EmployeeLendingEscrowV3.sol))                      | `repayOnBehalf` only lets the named agent repay the borrower's own loan to its lender, and enforces the per-repayment cap, rolling period cap, minimum reserve (against the live balance), due-date window, expiry, mandate nonce and unique repayment id.                                                                                                                                                                                           |

A compromised agent key can at most move capped amounts from a borrower to that
borrower's own lender. Replacing the mandate increments its nonce, which makes
any in-flight plan revert with `MandateChanged`.

Database guards back this up: one active mandate per borrower, one agent run at a
time per borrower (stale leases expire after 15 minutes), one submitted agent
repayment per borrower, and the existing one-pending-repayment-per-loan
constraint.

## Duplicate and crash safety

- The repayment id is derived from the intent id. A reverted attempt never
  consumes it, so retrying with the same id is at-most-once.
- The transaction is signed locally and its hash is persisted **before**
  broadcast. A crash cannot leave an unrecorded payment, and the database
  refuses a second in-flight payment before it can be broadcast.
- A broadcast error after signing is treated as "in flight", not "failed". The
  next cycle monitors the hash, and a payment is declared dropped only when the
  node has never seen it after 10 minutes.

## Human approval

If an obligation is due soon but no amount fits the mandate (for example,
paying would breach the reserve), the agent opens a 48-hour approval request
and emails the borrower. The borrower approves on `/app/agent` with their
passkey. The operation raises the escrow allowance by exactly that amount, so
the mandate's own allowance is preserved, and calls `repayLoanPartial`. The
server verifies the receipt, records the repayment, appends the result to the
run's log, and starts a follow-up cycle against the new balance.

## Privacy

- The model sees amounts, due-date distances and loan references only, never
  names, emails, wallet addresses or loan ids.
- Employers see only the agent's actions on their organization's loans (action,
  amount, status, transaction). They never see the borrower's wallet balance or
  the agent's reasoning, both of which describe the employee's personal
  finances.

## Code map

```text
contracts/EmployeeLendingEscrowV3.sol        V1-compatible escrow + partial repayment + mandate
src/integrations/arc/escrow-v3.ts            V3 ABI, error names, repayment-id derivation
src/modules/repayment-agent/
  domain/       agent-policy, agent-decision, agent-run, receipt-verification
  application/  run-repayment-agent (loop), observe, validate-agent-plan,
                execute-agent-action, planner, ports
  tools/        repayment-tools (typed read tools for planners)
  infrastructure/
                openai-planner, rule-based-planner, viem-repayment-gateway,
                prisma-repayment-agent-repository, agent-adapters,
                agent-environment, repayment-agent-service
  evals/        simulated-chain, sim-world, scenarios
  ui/           agent-controls, agent-activity, employer-agent-actions
src/app/(employee)/app/agent                 borrower page
src/app/api/repayment-agent/**               mandate, approval and manual-run routes
src/app/api/internal/repayment-agent         scheduler route (bearer secret)
```

## Running it locally

```bash
npm run agent:demo        # real V3 contract on in-process Hardhat; uses OPENAI_* if set
npm run agent:eval        # 18-scenario scorecard against the simulated escrow
npm run agent:scenario -- demo-replan-after-balance-change   # full activity log
npm run test:contracts    # includes 9 V3 contract tests
```

The demo deploys the contract and creates two loans (52.5 and 30 USDC) for a
borrower holding 90 USDC under a mandate of 25 USDC per repayment, 100 USDC per
period and a 40 USDC reserve. The agent pays 25 USDC on L1 and verifies the
receipt. The borrower then spends 27 USDC; the agent detects the change,
re-plans L2, sees that paying would breach the reserve, and requests approval.
The borrower approves and that payment is verified too.

## Evaluations

[`scenarios.ts`](../src/modules/repayment-agent/evals/scenarios.ts) scores each
case on policy compliance, correct action, no unauthorized transfers, no
duplicate execution, explanation completeness, and recovery or escalation. The
cases are:

- due soon with enough funds, and with too little;
- competing obligations and the reserve constraint;
- stale reconciliation;
- a pending operation, a transient revert, a deterministic revert, a dropped
  transaction, a broadcast error after signing, and a signing failure;
- concurrent runs;
- a balance change between planning and execution;
- malicious model output naming an unknown contract or an unowned loan;
- an explanation inconsistent with the chosen action;
- a tampered receipt;
- a missing mandate;
- the demo story.

The scripted adversarial planners stand in for a model, so the boundary is
tested independently of any model's behavior.

## Deploying to Arc Testnet

1. Deploy V3 with the existing borrow-authorizer:
   `npm run contracts:deploy:arc:v3`. This needs `ARC_DEPLOYER_PRIVATE_KEY`,
   `ARC_BORROW_AUTHORIZER_ADDRESS` and `ARC_BORROW_AUTHORIZER_PRIVATE_KEY`.
2. Wind down V1 first. Switching `NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS`
   makes open V1 offers and loans unavailable to the app, so repay or cancel
   them beforehand.
3. Set `NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS`, `ARC_ESCROW_VERSION=3`,
   `ARC_RECONCILIATION_START_BLOCK` (from the deploy output),
   `REPAYMENT_AGENT_ENABLED=true`, a new `ARC_REPAYMENT_AGENT_PRIVATE_KEY`
   (distinct from the authorizer; fund it with testnet USDC for gas) and
   `REPAYMENT_AGENT_CRON_SECRET`. Optionally set `OPENAI_API_KEY` and
   `OPENAI_MODEL`.
4. Apply the migration: `npm run prisma:deploy`.
5. Give the scheduler `REPAYMENT_AGENT_CRON_SECRET`. It also now calls
   `/api/internal/repayment-operations` when `REPAYMENT_OPERATIONS_CRON_SECRET`
   is set, which it previously never did.

## Known limitations

- Agent partial repayments are verified by the agent itself. The reconciliation
  scanner ingests only `OfferCreated`, `LoanStarted` and `LoanRepaid`, so a
  partial payment whose recording was interrupted is recovered by the agent's
  in-flight monitoring, not by reconciliation.
- An abandoned manual repayment intent (created but never submitted) holds the
  per-loan pending slot. The agent then reports `DUPLICATE_BLOCKED` until that
  intent is resolved.
- `OPENAI_MODEL` is configuration, not code. Validate the chosen model's
  strict function-calling support before relying on it. The deterministic
  fallback keeps the agent working if the model is unavailable.
- The agent key is a raw environment secret. Managed key custody (KMS/HSM)
  remains a production-readiness item, as it is for the borrow authorizer.
