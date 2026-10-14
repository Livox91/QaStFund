import {
  erc20Abi,
  getAddress,
  parseEventLogs,
  type Address,
  type Log,
} from "viem";

import { ARC_USDC_ADDRESS } from "@/integrations/arc/arc-testnet";

export function normalizeArcTransferRecipient(
  recipient: string,
  sender?: string,
): { recipient: Address; selfTransfer: boolean } {
  const normalized = getAddress(recipient);
  if (normalized === "0x0000000000000000000000000000000000000000") {
    throw new Error("ZERO_ADDRESS");
  }
  return {
    recipient: normalized,
    selfTransfer:
      typeof sender === "string" &&
      normalized.toLowerCase() === getAddress(sender).toLowerCase(),
  };
}

export function hasExactSingleOutgoingUsdcTransfer(
  logs: readonly Log[],
  input: { sender: string; recipient: string; amountBaseUnits: bigint },
): boolean {
  const decoded = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: logs.filter(
      (log) => log.address.toLowerCase() === ARC_USDC_ADDRESS.toLowerCase(),
    ),
    strict: false,
  });
  const outgoing = decoded.filter(
    (log) => log.args.from?.toLowerCase() === input.sender.toLowerCase(),
  );
  const exact = outgoing.filter(
    (log) =>
      log.args.to?.toLowerCase() === input.recipient.toLowerCase() &&
      log.args.value === input.amountBaseUnits,
  );
  return outgoing.length === 1 && exact.length === 1;
}
