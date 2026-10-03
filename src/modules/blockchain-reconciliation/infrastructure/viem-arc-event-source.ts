import "server-only";

import { createPublicClient, getAddress, http } from "viem";

import { arcTestnet } from "@/integrations/arc/arc-testnet";
import { employeeLendingEscrowAbi } from "@/integrations/arc/employee-lending-escrow";
import type { ReconciliationEventSource } from "@/modules/blockchain-reconciliation/application/ports";
import type {
  ReconciliationEvent,
  StoredReconciliationEvent,
} from "@/modules/blockchain-reconciliation/domain/blockchain-event";

export function createViemArcEventSource(input: {
  contractAddress: `0x${string}`;
  rpcUrl: string;
}): ReconciliationEventSource {
  const contractAddress = getAddress(input.contractAddress);
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(input.rpcUrl),
  });

  return {
    getChainId: () => client.getChainId(),
    getLatestBlockNumber: () => client.getBlockNumber(),
    async getEvents(fromBlock, toBlock) {
      const logs = await client.getContractEvents({
        address: contractAddress,
        abi: employeeLendingEscrowAbi,
        fromBlock,
        toBlock,
      });
      const timestamps = new Map<bigint, Date>();
      for (const blockNumber of new Set(logs.map((log) => log.blockNumber))) {
        const block = await client.getBlock({ blockNumber });
        timestamps.set(blockNumber, new Date(Number(block.timestamp) * 1_000));
      }

      const events: ReconciliationEvent[] = [];
      for (const log of logs) {
        if (
          log.blockHash === null ||
          log.transactionHash === null ||
          log.logIndex === null
        ) {
          continue;
        }
        const base = {
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          blockTimestamp: timestamps.get(log.blockNumber)!,
          logIndex: log.logIndex,
          transactionHash: log.transactionHash,
        } as const;
        if (log.eventName === "OfferCreated") {
          const {
            offerId,
            lender,
            principal,
            interestBps,
            duration,
            requestId,
          } = log.args;
          if (
            offerId === undefined ||
            lender === undefined ||
            principal === undefined ||
            interestBps === undefined ||
            duration === undefined ||
            requestId === undefined
          ) {
            continue;
          }
          events.push({
            ...base,
            name: "OFFER_CREATED",
            payload: {
              offerId: offerId.toString(),
              lender: lender.toLowerCase(),
              principal: principal.toString(),
              interestBps: interestBps.toString(),
              duration: duration.toString(),
              requestId: requestId.toLowerCase(),
            },
          });
        } else if (log.eventName === "LoanStarted") {
          const {
            loanId,
            offerId,
            lender,
            borrower,
            principal,
            repaymentAmount,
            startTime,
            dueTime,
          } = log.args;
          if (
            loanId === undefined ||
            offerId === undefined ||
            lender === undefined ||
            borrower === undefined ||
            principal === undefined ||
            repaymentAmount === undefined ||
            startTime === undefined ||
            dueTime === undefined
          ) {
            continue;
          }
          events.push({
            ...base,
            name: "LOAN_STARTED",
            payload: {
              loanId: loanId.toString(),
              offerId: offerId.toString(),
              lender: lender.toLowerCase(),
              borrower: borrower.toLowerCase(),
              principal: principal.toString(),
              repaymentAmount: repaymentAmount.toString(),
              startTime: startTime.toString(),
              dueTime: dueTime.toString(),
            },
          });
        } else if (log.eventName === "LoanRepaid") {
          const { loanId, borrower, lender, amount, repaidAt } = log.args;
          if (
            loanId === undefined ||
            borrower === undefined ||
            lender === undefined ||
            amount === undefined ||
            repaidAt === undefined
          ) {
            continue;
          }
          events.push({
            ...base,
            name: "LOAN_REPAID",
            payload: {
              loanId: loanId.toString(),
              borrower: borrower.toLowerCase(),
              lender: lender.toLowerCase(),
              amount: amount.toString(),
              repaidAt: repaidAt.toString(),
            },
          });
        }
      }
      return events.sort(
        (left, right) =>
          Number(left.blockNumber - right.blockNumber) ||
          left.logIndex - right.logIndex,
      );
    },
    async verifyEvent(event: StoredReconciliationEvent) {
      if (event.name === "OFFER_CREATED") {
        const offer = await client.readContract({
          address: contractAddress,
          abi: employeeLendingEscrowAbi,
          functionName: "offers",
          args: [BigInt(event.payload.offerId)],
        });
        return (
          offer[0] === BigInt(event.payload.offerId) &&
          offer[1].toLowerCase() === event.payload.lender &&
          offer[2] === BigInt(event.payload.principal) &&
          offer[3] === BigInt(event.payload.interestBps) &&
          offer[4] === BigInt(event.payload.duration) &&
          offer[6].toLowerCase() === event.payload.requestId
        );
      }
      const loan = await client.readContract({
        address: contractAddress,
        abi: employeeLendingEscrowAbi,
        functionName: "loans",
        args: [BigInt(event.payload.loanId)],
      });
      if (event.name === "LOAN_STARTED") {
        return (
          loan[0] === BigInt(event.payload.loanId) &&
          loan[1] === BigInt(event.payload.offerId) &&
          loan[2].toLowerCase() === event.payload.lender &&
          loan[3].toLowerCase() === event.payload.borrower &&
          loan[4] === BigInt(event.payload.principal) &&
          loan[6] === BigInt(event.payload.repaymentAmount) &&
          loan[7] === BigInt(event.payload.startTime) &&
          loan[8] === BigInt(event.payload.dueTime)
        );
      }
      return (
        loan[0] === BigInt(event.payload.loanId) &&
        loan[2].toLowerCase() === event.payload.lender &&
        loan[3].toLowerCase() === event.payload.borrower &&
        loan[6] === BigInt(event.payload.amount) &&
        loan[9] === 1 &&
        loan[10] === BigInt(event.payload.repaidAt)
      );
    },
  };
}
