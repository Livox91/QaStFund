export function finalizedBlock(
  latestBlock: bigint,
  confirmationDepth: number,
): bigint {
  const depth = BigInt(confirmationDepth);
  return latestBlock > depth ? latestBlock - depth : 0n;
}

export function reconciliationBacklog(
  cursorNextBlock: bigint,
  finalizedThrough: bigint,
): bigint {
  return cursorNextBlock > finalizedThrough
    ? 0n
    : finalizedThrough - cursorNextBlock + 1n;
}

export function reconciliationProgress(input: {
  cursorNextBlock: bigint;
  latestBlock: bigint;
  confirmationDepth: number;
  blockRange: number;
  maxRangesPerRun: number;
}) {
  const finalizedThrough = finalizedBlock(
    input.latestBlock,
    input.confirmationDepth,
  );
  const backlogBlocks = reconciliationBacklog(
    input.cursorNextBlock,
    finalizedThrough,
  );
  const healthWindowBlocks = BigInt(input.blockRange);
  const maxBlocksPerRun =
    BigInt(input.blockRange) * BigInt(input.maxRangesPerRun);
  return {
    finalizedThrough,
    backlogBlocks,
    healthWindowBlocks,
    maxBlocksPerRun,
    stale: backlogBlocks > healthWindowBlocks,
    caughtUp: backlogBlocks === 0n,
  };
}
