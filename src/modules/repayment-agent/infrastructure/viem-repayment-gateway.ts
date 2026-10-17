import {
  BaseError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  keccak256,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

import {
  employeeLendingEscrowAbi,
  erc20UsdcAbi,
} from "@/integrations/arc/employee-lending-escrow";
import {
  NON_RETRYABLE_ESCROW_ERRORS,
  erc20AllowanceAbi,
  escrowV3Abi,
} from "@/integrations/arc/escrow-v3";
import type {
  AgentRepaymentRequest,
  BorrowerChainState,
  ChainLoanState,
  ExpectedRepayment,
  RepaymentChainGateway,
  SimulationResult,
} from "@/modules/repayment-agent/application/ports";
import {
  verifyRepaymentLogs,
  type RepaymentVerification,
} from "@/modules/repayment-agent/domain/receipt-verification";

type Clients = Readonly<{
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
  contractAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}>;

function revertName(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (item) => item instanceof ContractFunctionRevertedError,
    );
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? "UNKNOWN_REVERT";
    }
  }
  return "SIMULATION_UNAVAILABLE";
}

/** Chain gateway for EmployeeLendingEscrowV3 on any viem-supported chain. */
export class ViemRepaymentGateway implements RepaymentChainGateway {
  readonly agentAddress: string;
  readonly contractAddress: string;
  readonly usdcAddress: string;

  constructor(private readonly clients: Clients) {
    this.agentAddress = clients.walletClient.account.address;
    this.contractAddress = getAddress(clients.contractAddress);
    this.usdcAddress = getAddress(clients.usdcAddress);
  }

  async readBorrowerState(walletAddress: string): Promise<BorrowerChainState> {
    const owner = getAddress(walletAddress);
    const { publicClient, contractAddress, usdcAddress } = this.clients;
    const [balance, allowance, mandate] = await Promise.all([
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20UsdcAbi,
        functionName: "balanceOf",
        args: [owner],
      }),
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20AllowanceAbi,
        functionName: "allowance",
        args: [owner, contractAddress],
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: escrowV3Abi,
        functionName: "repaymentMandates",
        args: [owner],
      }),
    ]);
    const [
      agent,
      maxPerRepayment,
      maxPerPeriod,
      minimumReserve,
      periodSeconds,
      earliestBeforeDueSeconds,
      expiresAt,
      periodStart,
      spentInPeriod,
      nonce,
      active,
    ] = mandate;
    return {
      walletBalanceBaseUnits: balance,
      allowanceBaseUnits: allowance,
      mandate:
        nonce === 0n
          ? null
          : {
              agentAddress: agent,
              maxPerRepaymentBaseUnits: maxPerRepayment,
              maxPerPeriodBaseUnits: maxPerPeriod,
              minimumReserveBaseUnits: minimumReserve,
              periodSeconds: Number(periodSeconds),
              earliestBeforeDueSeconds: Number(earliestBeforeDueSeconds),
              expiresAt: new Date(Number(expiresAt) * 1_000),
              periodStartedAt: new Date(Number(periodStart) * 1_000),
              spentInPeriodBaseUnits: spentInPeriod,
              nonce,
              active,
            },
    };
  }

  async readLoan(chainLoanId: string): Promise<ChainLoanState> {
    const { publicClient, contractAddress } = this.clients;
    const [loan, repaid] = await Promise.all([
      publicClient.readContract({
        address: contractAddress,
        abi: employeeLendingEscrowAbi,
        functionName: "loans",
        args: [BigInt(chainLoanId)],
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: escrowV3Abi,
        functionName: "repaidAmounts",
        args: [BigInt(chainLoanId)],
      }),
    ]);
    return {
      chainLoanId,
      borrower: loan[3],
      lender: loan[2],
      repaymentAmountBaseUnits: loan[6],
      repaidBaseUnits: repaid,
      dueAt: new Date(Number(loan[8]) * 1_000),
      active: loan[0] !== 0n && loan[9] === 0,
    };
  }

  private callData(request: AgentRepaymentRequest) {
    return encodeFunctionData({
      abi: escrowV3Abi,
      functionName: "repayOnBehalf",
      args: [
        BigInt(request.chainLoanId),
        request.amountBaseUnits,
        request.chainRepaymentId,
        request.mandateNonce,
      ],
    });
  }

  async simulateAgentRepayment(
    request: AgentRepaymentRequest,
  ): Promise<SimulationResult> {
    try {
      await this.clients.publicClient.simulateContract({
        account: this.clients.walletClient.account,
        address: this.clients.contractAddress,
        abi: escrowV3Abi,
        functionName: "repayOnBehalf",
        args: [
          BigInt(request.chainLoanId),
          request.amountBaseUnits,
          request.chainRepaymentId,
          request.mandateNonce,
        ],
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, errorName: revertName(error) };
    }
  }

  async submitAgentRepayment(
    request: AgentRepaymentRequest,
    onSigned: (transactionHash: `0x${string}`) => Promise<void>,
  ): Promise<`0x${string}`> {
    const { walletClient, publicClient, contractAddress } = this.clients;
    const prepared = await walletClient.prepareTransactionRequest({
      account: walletClient.account,
      chain: walletClient.chain,
      to: contractAddress,
      data: this.callData(request),
    });
    const serializedTransaction = await walletClient.signTransaction(
      prepared as Parameters<typeof walletClient.signTransaction>[0],
    );
    const hash = keccak256(serializedTransaction);
    // Persist before broadcast: a crash can never leave an unrecorded payment.
    await onSigned(hash);
    try {
      await publicClient.sendRawTransaction({ serializedTransaction });
    } catch {
      // Rebroadcasting the identical signed transaction is idempotent.
      await publicClient.sendRawTransaction({ serializedTransaction });
    }
    return hash;
  }

  async verifyRepayment(
    transactionHash: `0x${string}`,
    expected: ExpectedRepayment,
    timeoutMs: number,
  ): Promise<RepaymentVerification> {
    const { publicClient } = this.clients;
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: timeoutMs,
      });
    } catch {
      const transaction = await publicClient
        .getTransaction({ hash: transactionHash })
        .catch(() => null);
      return {
        status: "PENDING",
        transactionKnown: transaction !== null,
        checks: [],
      };
    }

    const checks = [
      {
        code: "TRANSACTION_TARGET",
        passed:
          receipt.to?.toLowerCase() === this.contractAddress.toLowerCase() &&
          receipt.from.toLowerCase() ===
            (expected.agent ?? expected.borrower).toLowerCase(),
        detail: "Transaction was sent by the expected account to the escrow.",
      },
    ];
    if (receipt.status !== "success") {
      const errorName = await this.diagnoseRevert(transactionHash);
      return {
        status: "REVERTED",
        errorName,
        retryable:
          errorName === null || !NON_RETRYABLE_ESCROW_ERRORS.has(errorName),
        checks,
      };
    }
    const result = verifyRepaymentLogs(receipt.logs, {
      contractAddress: this.contractAddress,
      usdcAddress: this.usdcAddress,
      ...expected,
    });
    checks.push(...result.checks);
    if (!result.verified || !checks.every((check) => check.passed)) {
      return { status: "MISMATCH", checks };
    }
    const [loan, block] = await Promise.all([
      this.readLoan(expected.chainLoanId),
      publicClient.getBlock({ blockNumber: receipt.blockNumber }),
    ]);
    const stateMatches = loan.repaidBaseUnits >= result.totalRepaidBaseUnits;
    checks.push({
      code: "CONTRACT_STATE_MATCHES",
      passed: stateMatches,
      detail: "repaidAmounts() reflects the verified repayment.",
    });
    if (!stateMatches) return { status: "MISMATCH", checks };
    return {
      status: "VERIFIED",
      checks,
      totalRepaidBaseUnits: result.totalRepaidBaseUnits,
      remainingBaseUnits: result.remainingBaseUnits,
      blockNumber: receipt.blockNumber,
      blockTimestamp: new Date(Number(block.timestamp) * 1_000),
    };
  }

  /** Replays the reverted call against current state to name the reason. */
  private async diagnoseRevert(transactionHash: `0x${string}`) {
    const transaction = await this.clients.publicClient
      .getTransaction({ hash: transactionHash })
      .catch(() => null);
    if (!transaction) return null;
    try {
      const decoded = decodeFunctionData({
        abi: escrowV3Abi,
        data: transaction.input,
      });
      if (decoded.functionName !== "repayOnBehalf") return null;
      const [loanId, amount, repaymentId, nonce] = decoded.args;
      const simulation = await this.simulateAgentRepayment({
        chainLoanId: loanId.toString(),
        amountBaseUnits: amount,
        chainRepaymentId: repaymentId,
        mandateNonce: nonce,
      });
      return simulation.ok ? null : simulation.errorName;
    } catch {
      return null;
    }
  }
}
