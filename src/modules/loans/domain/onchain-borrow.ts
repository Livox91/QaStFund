export function calculateOnChainRepaymentBaseUnits(
  principalBaseUnits: bigint,
  interestBasisPoints: number,
): bigint {
  if (principalBaseUnits <= 0n) throw new Error("Principal must be positive.");
  if (
    !Number.isInteger(interestBasisPoints) ||
    interestBasisPoints < 0 ||
    interestBasisPoints > 10_000
  ) {
    throw new Error("Interest basis points are invalid.");
  }
  const interest =
    (principalBaseUnits * BigInt(interestBasisPoints) + 9_999n) / 10_000n;
  return principalBaseUnits + interest;
}

export function friendlyBorrowTransactionError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("reject") || message.includes("cancel")) {
    return "Wallet authorization was cancelled. No funds were received.";
  }
  return "This offer is no longer available. Choose another lending offer.";
}
