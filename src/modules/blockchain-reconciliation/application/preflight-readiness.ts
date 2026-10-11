export type ReconciliationPreflightInput = Readonly<{
  enabled: boolean;
  rpcUrl: string;
  expectedRpcUrl: string;
  startBlock: bigint;
  latestBlock: bigint;
  cronSecret: string | undefined;
}>;

export function getReconciliationPreflightIssues(
  input: ReconciliationPreflightInput,
): string[] {
  const issues: string[] = [];
  if (!input.enabled) {
    issues.push("ARC_RECONCILIATION_ENABLED must be explicitly true");
  }
  if (input.rpcUrl !== input.expectedRpcUrl) {
    issues.push("reconciliation RPC is not the intended Arc Testnet RPC");
  }
  if (input.startBlock <= 0n || input.startBlock > input.latestBlock) {
    issues.push("reconciliation start block is outside the current Arc chain");
  }
  if (!input.cronSecret || input.cronSecret.length < 32) {
    issues.push(
      "ARC_RECONCILIATION_CRON_SECRET must contain at least 32 characters",
    );
  }
  return issues;
}

export function getReconciliationCatchUpIssue(input: {
  cursorNextBlock: string | null;
  latestBlock: bigint;
  confirmationDepth: number;
  blockRange: number;
}): string | null {
  if (!input.cursorNextBlock || !/^\d+$/.test(input.cursorNextBlock)) {
    return "reconciliation has no valid persisted cursor";
  }
  const finalizedHead =
    input.latestBlock > BigInt(input.confirmationDepth)
      ? input.latestBlock - BigInt(input.confirmationDepth)
      : 0n;
  const cursorNextBlock = BigInt(input.cursorNextBlock);
  const lag =
    cursorNextBlock > finalizedHead ? 0n : finalizedHead - cursorNextBlock + 1n;
  if (lag > BigInt(input.blockRange)) {
    return `reconciliation cursor ${cursorNextBlock} is ${lag} blocks behind finalized block ${finalizedHead}, exceeding the configured ${input.blockRange}-block range`;
  }
  return null;
}
