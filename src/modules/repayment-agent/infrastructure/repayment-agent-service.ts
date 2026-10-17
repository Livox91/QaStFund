import "server-only";

import { randomUUID } from "node:crypto";

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { prisma } from "@/infrastructure/database/prisma";
import { validateEnvironment } from "@/infrastructure/config/environment";
import { logger } from "@/infrastructure/logging/logger";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_USDC_ADDRESS,
  arcTestnet,
} from "@/integrations/arc/arc-testnet";
import {
  erc20UsdcAbi,
  getConfiguredEscrowAddress,
} from "@/integrations/arc/employee-lending-escrow";
import { escrowV3Abi } from "@/integrations/arc/escrow-v3";
import {
  requireEmployee,
  requireEmployerAdmin,
} from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  FallbackPlanner,
  type RepaymentPlanner,
} from "@/modules/repayment-agent/application/planner";
import type { BorrowerRef } from "@/modules/repayment-agent/application/ports";
import {
  runRepaymentAgent,
  type RepaymentAgentDependencies,
} from "@/modules/repayment-agent/application/run-repayment-agent";
import { toJsonSafe } from "@/modules/repayment-agent/domain/agent-run";
import { verifyRepaymentLogs } from "@/modules/repayment-agent/domain/receipt-verification";
import {
  createReconciliationHealthReader,
  emailRepaymentNotifier,
} from "@/modules/repayment-agent/infrastructure/agent-adapters";
import {
  RepaymentAgentNotConfiguredError,
  parseAgentEnvironment,
} from "@/modules/repayment-agent/infrastructure/agent-environment";
import { OpenAiRepaymentPlanner } from "@/modules/repayment-agent/infrastructure/openai-planner";
import {
  prismaRepaymentAgentRepository,
  settleVerifiedRepayment,
} from "@/modules/repayment-agent/infrastructure/prisma-repayment-agent-repository";
import { RuleBasedRepaymentPlanner } from "@/modules/repayment-agent/infrastructure/rule-based-planner";
import { ViemRepaymentGateway } from "@/modules/repayment-agent/infrastructure/viem-repayment-gateway";
import type { PrepareMandateInput } from "@/modules/repayment-agent/schemas/repayment-agent.schema";
import { ApplicationError } from "@/shared/errors/application-error";
import { parseUsdc } from "@/shared/money/usdc";
import { systemClock } from "@/shared/time/clock";

const MANDATE_PERIOD_SECONDS = 30 * 86_400;
const MAX_PER_REPAYMENT_BASE_UNITS = 10_000n * 1_000_000n;

function notConfigured(message: string) {
  return new ApplicationError("REPAYMENT_AGENT_NOT_CONFIGURED", message, 503);
}

type Runtime = Readonly<{
  chain: Chain;
  contractAddress: `0x${string}`;
  gateway: ViemRepaymentGateway;
  publicClient: ReturnType<typeof createPublicClient>;
  planner: RepaymentPlanner;
  maxBorrowersPerRun: number;
  requireReconciliation: boolean;
}>;

let cachedRuntime: Runtime | null = null;

function runtime(): Runtime {
  if (cachedRuntime) return cachedRuntime;
  let environment;
  try {
    environment = parseAgentEnvironment();
  } catch (error) {
    if (error instanceof RepaymentAgentNotConfiguredError) {
      throw notConfigured("The repayment agent is not configured.");
    }
    throw error;
  }
  if (!environment.REPAYMENT_AGENT_ENABLED) {
    throw notConfigured("The repayment agent is disabled.");
  }
  const contractAddress = getConfiguredEscrowAddress();
  if (!contractAddress || !environment.ARC_REPAYMENT_AGENT_PRIVATE_KEY) {
    throw notConfigured("The mandate-capable escrow is not configured.");
  }
  const transport = http(environment.ARC_RPC_URL);
  const publicClient = createPublicClient({ chain: arcTestnet, transport });
  const walletClient = createWalletClient({
    account: privateKeyToAccount(
      environment.ARC_REPAYMENT_AGENT_PRIVATE_KEY as `0x${string}`,
    ),
    chain: arcTestnet,
    transport,
  });
  const gateway = new ViemRepaymentGateway({
    publicClient: publicClient as never,
    walletClient,
    contractAddress,
    usdcAddress: ARC_USDC_ADDRESS,
  });
  const rules = new RuleBasedRepaymentPlanner();
  const planner =
    environment.OPENAI_API_KEY && environment.OPENAI_MODEL
      ? new FallbackPlanner(
          new OpenAiRepaymentPlanner({
            apiKey: environment.OPENAI_API_KEY,
            model: environment.OPENAI_MODEL,
            baseUrl: environment.OPENAI_BASE_URL,
          }),
          rules,
        )
      : rules;
  cachedRuntime = {
    chain: arcTestnet,
    contractAddress,
    gateway,
    publicClient: publicClient as ReturnType<typeof createPublicClient>,
    planner,
    maxBorrowersPerRun: environment.REPAYMENT_AGENT_MAX_BORROWERS_PER_RUN,
    requireReconciliation: environment.REPAYMENT_AGENT_REQUIRE_RECONCILIATION,
  };
  return cachedRuntime;
}

export function createRepaymentAgentDependencies(): RepaymentAgentDependencies {
  const current = runtime();
  return {
    repository: prismaRepaymentAgentRepository,
    gateway: current.gateway,
    reconciliation: createReconciliationHealthReader({
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: current.contractAddress,
      required: current.requireReconciliation,
      staleAfterMinutes:
        validateEnvironment().ARC_RECONCILIATION_STALE_AFTER_MINUTES,
    }),
    notifier: emailRepaymentNotifier,
    planner: current.planner,
    clock: systemClock,
    newId: randomUUID,
  };
}

async function borrowerContext(actor: AuthenticatedActor) {
  const employee = requireEmployee(actor);
  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: employee.organizationId,
        userId: employee.userId,
      },
    },
    select: {
      id: true,
      isActive: true,
      user: {
        select: {
          arcWallets: {
            where: { network: "ARC_TESTNET", status: "ACTIVE" },
            select: { address: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!membership?.isActive) {
    throw new ApplicationError("FORBIDDEN", "Forbidden.", 403);
  }
  const wallet = membership.user.arcWallets[0]?.address ?? null;
  return {
    borrower: {
      organizationId: employee.organizationId,
      borrowerMembershipId: membership.id,
    } satisfies BorrowerRef,
    walletAddress: wallet,
  };
}

function requireWallet(walletAddress: string | null): `0x${string}` {
  if (!walletAddress) {
    throw new ApplicationError(
      "ARC_WALLET_NOT_READY",
      "Set up your Arc wallet before configuring the repayment agent.",
      409,
    );
  }
  return getAddress(walletAddress);
}

export async function runRepaymentAgentForActor(actor: AuthenticatedActor) {
  const { borrower } = await borrowerContext(actor);
  return runRepaymentAgent(
    borrower,
    "MANUAL",
    createRepaymentAgentDependencies(),
  );
}

/** Scheduler entry point: every borrower with an active mandate or in-flight payment. */
export async function runScheduledRepaymentAgents() {
  const current = runtime();
  const [mandates, inFlight] = await Promise.all([
    prisma.repaymentAgentMandate.findMany({
      where: {
        status: "ACTIVE",
        contractAddress: current.contractAddress.toLowerCase(),
      },
      select: { organizationId: true, borrowerMembershipId: true },
      take: current.maxBorrowersPerRun,
    }),
    prisma.repaymentAgentAction.findMany({
      where: { status: "SUBMITTED" },
      select: { organizationId: true, borrowerMembershipId: true },
      take: current.maxBorrowersPerRun,
    }),
  ]);
  const unique = new Map<string, BorrowerRef>();
  for (const item of [...inFlight, ...mandates]) {
    unique.set(item.borrowerMembershipId, item);
  }
  const deps = createRepaymentAgentDependencies();
  const results: Array<{ status: string; outcomeCode: string }> = [];
  for (const borrower of [...unique.values()].slice(
    0,
    current.maxBorrowersPerRun,
  )) {
    try {
      const summary = await runRepaymentAgent(borrower, "SCHEDULED", deps);
      results.push({
        status: summary.status,
        outcomeCode: summary.outcomeCode,
      });
    } catch (error) {
      logger.error("Scheduled repayment agent run failed", error, {
        borrowerMembershipId: borrower.borrowerMembershipId,
      });
      results.push({ status: "FAILED", outcomeCode: "RUN_ERROR" });
    }
  }
  return {
    considered: unique.size,
    paymentsOrApprovals: results.filter((item) =>
      ["COMPLETED", "AWAITING_APPROVAL"].includes(item.status),
    ).length,
    failed: results.filter((item) => item.status === "FAILED").length,
    results,
  };
}

function mandateParameters(input: PrepareMandateInput, now: Date) {
  let maxPerRepayment: bigint;
  let maxPerPeriod: bigint;
  let minimumReserve: bigint;
  try {
    maxPerRepayment = parseUsdc(input.maxPerRepaymentUsdc);
    maxPerPeriod = parseUsdc(input.maxPerPeriodUsdc);
    minimumReserve = parseUsdc(input.minimumReserveUsdc);
  } catch {
    throw new ApplicationError(
      "INVALID_MANDATE",
      "Enter valid USDC amounts.",
      400,
    );
  }
  if (
    maxPerRepayment <= 0n ||
    maxPerRepayment > MAX_PER_REPAYMENT_BASE_UNITS ||
    maxPerPeriod < maxPerRepayment
  ) {
    throw new ApplicationError(
      "INVALID_MANDATE",
      "The monthly limit must be at least the per-repayment limit, and the per-repayment limit must be positive.",
      400,
    );
  }
  const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000);
  return {
    maxPerRepayment,
    maxPerPeriod,
    minimumReserve,
    earliestBeforeDueSeconds: input.earliestBeforeDueDays * 86_400,
    expiresAt: new Date(Math.floor(expiresAt.getTime() / 1_000) * 1_000),
  };
}

function mandateCalls(
  current: Runtime,
  record: {
    maxPerRepaymentBaseUnits: bigint;
    maxPerPeriodBaseUnits: bigint;
    minimumReserveBaseUnits: bigint;
    earliestBeforeDueSeconds: number;
    expiresAt: Date;
    allowanceBaseUnits: bigint;
  },
) {
  return [
    {
      to: ARC_USDC_ADDRESS,
      data: encodeFunctionData({
        abi: erc20UsdcAbi,
        functionName: "approve",
        args: [current.contractAddress, record.allowanceBaseUnits],
      }),
    },
    {
      to: current.contractAddress,
      data: encodeFunctionData({
        abi: escrowV3Abi,
        functionName: "setRepaymentMandate",
        args: [
          getAddress(current.gateway.agentAddress),
          record.maxPerRepaymentBaseUnits,
          record.maxPerPeriodBaseUnits,
          record.minimumReserveBaseUnits,
          BigInt(MANDATE_PERIOD_SECONDS),
          BigInt(record.earliestBeforeDueSeconds),
          BigInt(Math.floor(record.expiresAt.getTime() / 1_000)),
        ],
      }),
    },
  ];
}

export async function prepareRepaymentMandate(
  actor: AuthenticatedActor,
  input: PrepareMandateInput,
) {
  const current = runtime();
  const { borrower, walletAddress } = await borrowerContext(actor);
  const wallet = requireWallet(walletAddress);
  const existing = await prisma.repaymentAgentMandate.findUnique({
    where: { requestId: input.requestId },
  });
  if (
    existing &&
    existing.borrowerMembershipId !== borrower.borrowerMembershipId
  ) {
    throw new ApplicationError(
      "MANDATE_REQUEST_CONFLICT",
      "This request was already used.",
      409,
    );
  }
  const record =
    existing ??
    (await (async () => {
      const parameters = mandateParameters(input, new Date());
      return prisma.repaymentAgentMandate.create({
        data: {
          organizationId: borrower.organizationId,
          borrowerMembershipId: borrower.borrowerMembershipId,
          requestId: input.requestId,
          walletAddress: wallet.toLowerCase(),
          contractAddress: current.contractAddress.toLowerCase(),
          agentAddress: current.gateway.agentAddress.toLowerCase(),
          maxPerRepaymentBaseUnits: parameters.maxPerRepayment,
          maxPerPeriodBaseUnits: parameters.maxPerPeriod,
          minimumReserveBaseUnits: parameters.minimumReserve,
          periodSeconds: MANDATE_PERIOD_SECONDS,
          earliestBeforeDueSeconds: parameters.earliestBeforeDueSeconds,
          expiresAt: parameters.expiresAt,
          allowanceBaseUnits: parameters.maxPerPeriod,
        },
      });
    })());
  return {
    mandateId: record.id,
    calls: mandateCalls(current, record),
  };
}

async function receiptFor(current: Runtime, transactionHash: `0x${string}`) {
  try {
    return await current.publicClient.getTransactionReceipt({
      hash: transactionHash,
    });
  } catch {
    throw new ApplicationError(
      "TRANSACTION_CONFIRMATION_PENDING",
      "The transaction is still being confirmed. Try again shortly.",
      409,
    );
  }
}

function escrowEvents(
  current: Runtime,
  logs: ReadonlyArray<{
    address: string;
    data: `0x${string}`;
    topics: readonly `0x${string}`[];
  }>,
) {
  const events = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== current.contractAddress.toLowerCase())
      continue;
    try {
      events.push(
        decodeEventLog({
          abi: escrowV3Abi,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        }),
      );
    } catch {
      // Account-abstraction and token logs.
    }
  }
  return events;
}

export async function confirmRepaymentMandate(
  actor: AuthenticatedActor,
  mandateId: string,
  transactionHash: `0x${string}`,
) {
  const current = runtime();
  const { borrower } = await borrowerContext(actor);
  const record = await prisma.repaymentAgentMandate.findFirst({
    where: {
      id: mandateId,
      borrowerMembershipId: borrower.borrowerMembershipId,
    },
  });
  if (!record)
    throw new ApplicationError("MANDATE_NOT_FOUND", "Mandate not found.", 404);
  if (record.status === "ACTIVE") return { status: "ACTIVE" as const };
  if (record.status !== "PENDING") {
    throw new ApplicationError(
      "MANDATE_NOT_PENDING",
      "This mandate can no longer be confirmed.",
      409,
    );
  }
  const receipt = await receiptFor(current, transactionHash);
  const event = escrowEvents(current, receipt.logs).find(
    (item) =>
      item.eventName === "RepaymentMandateSet" &&
      item.args.borrower.toLowerCase() === record.walletAddress &&
      item.args.agent.toLowerCase() === record.agentAddress &&
      item.args.maxPerRepayment === record.maxPerRepaymentBaseUnits &&
      item.args.maxPerPeriod === record.maxPerPeriodBaseUnits &&
      item.args.minimumReserve === record.minimumReserveBaseUnits &&
      item.args.periodSeconds === BigInt(record.periodSeconds) &&
      item.args.earliestBeforeDueSeconds ===
        BigInt(record.earliestBeforeDueSeconds) &&
      item.args.expiresAt ===
        BigInt(Math.floor(record.expiresAt.getTime() / 1_000)),
  );
  if (
    receipt.status !== "success" ||
    !event ||
    event.eventName !== "RepaymentMandateSet"
  ) {
    await prisma.repaymentAgentMandate.update({
      where: { id: record.id },
      data: {
        status: "FAILED",
        transactionHash: transactionHash.toLowerCase(),
      },
    });
    throw new ApplicationError(
      "MANDATE_NOT_VERIFIED",
      "The transaction did not set the expected mandate.",
      400,
    );
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.repaymentAgentMandate.updateMany({
      where: {
        borrowerMembershipId: borrower.borrowerMembershipId,
        status: "ACTIVE",
      },
      data: { status: "SUPERSEDED", revokedAt: now },
    }),
    prisma.repaymentAgentMandate.update({
      where: { id: record.id },
      data: {
        status: "ACTIVE",
        chainNonce: event.args.nonce.toString(),
        transactionHash: transactionHash.toLowerCase(),
        activatedAt: now,
      },
    }),
  ]);
  return { status: "ACTIVE" as const };
}

export function prepareMandateRevocation() {
  const current = runtime();
  return {
    calls: [
      {
        to: current.contractAddress,
        data: encodeFunctionData({
          abi: escrowV3Abi,
          functionName: "revokeRepaymentMandate",
        }),
      },
      {
        to: ARC_USDC_ADDRESS,
        data: encodeFunctionData({
          abi: erc20UsdcAbi,
          functionName: "approve",
          args: [current.contractAddress, 0n],
        }),
      },
    ],
  };
}

export async function confirmMandateRevocation(
  actor: AuthenticatedActor,
  transactionHash: `0x${string}`,
) {
  const current = runtime();
  const { borrower, walletAddress } = await borrowerContext(actor);
  const wallet = requireWallet(walletAddress);
  const receipt = await receiptFor(current, transactionHash);
  const revoked = escrowEvents(current, receipt.logs).some(
    (item) =>
      item.eventName === "RepaymentMandateRevoked" &&
      item.args.borrower.toLowerCase() === wallet.toLowerCase(),
  );
  if (receipt.status !== "success" || !revoked) {
    throw new ApplicationError(
      "REVOCATION_NOT_VERIFIED",
      "The mandate was not revoked.",
      400,
    );
  }
  await prisma.repaymentAgentMandate.updateMany({
    where: {
      borrowerMembershipId: borrower.borrowerMembershipId,
      status: "ACTIVE",
    },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  return { status: "REVOKED" as const };
}

async function approvalAction(actor: AuthenticatedActor, actionId: string) {
  const { borrower, walletAddress } = await borrowerContext(actor);
  const wallet = requireWallet(walletAddress);
  const action = await prisma.repaymentAgentAction.findFirst({
    where: {
      id: actionId,
      organizationId: borrower.organizationId,
      borrowerMembershipId: borrower.borrowerMembershipId,
      action: "REQUEST_APPROVAL",
    },
    include: {
      loan: {
        select: {
          chainLoanId: true,
          contractAddress: true,
          lenderWalletAddress: true,
        },
      },
    },
  });
  if (!action)
    throw new ApplicationError(
      "APPROVAL_NOT_FOUND",
      "Approval request not found.",
      404,
    );
  return { borrower, wallet, action };
}

export async function prepareRepaymentApproval(
  actor: AuthenticatedActor,
  actionId: string,
) {
  const current = runtime();
  const { wallet, action } = await approvalAction(actor, actionId);
  if (
    action.status !== "AWAITING_APPROVAL" ||
    (action.expiresAt && action.expiresAt < new Date())
  ) {
    throw new ApplicationError(
      "APPROVAL_NOT_OPEN",
      "This approval request is no longer open.",
      409,
    );
  }
  if (
    !action.loan.chainLoanId ||
    action.loan.contractAddress?.toLowerCase() !==
      current.contractAddress.toLowerCase() ||
    !action.amountBaseUnits
  ) {
    throw new ApplicationError(
      "APPROVAL_NOT_OPEN",
      "This loan cannot be repaid here.",
      409,
    );
  }
  const state = await current.gateway.readBorrowerState(wallet);
  if (state.walletBalanceBaseUnits < action.amountBaseUnits) {
    throw new ApplicationError(
      "INSUFFICIENT_USDC_BALANCE",
      "Your USDC balance is too low for this repayment.",
      409,
    );
  }
  // Raise the allowance by exactly this payment so the mandate's allowance survives.
  return {
    amountBaseUnits: action.amountBaseUnits.toString(),
    calls: [
      {
        to: ARC_USDC_ADDRESS,
        data: encodeFunctionData({
          abi: erc20UsdcAbi,
          functionName: "approve",
          args: [
            current.contractAddress,
            state.allowanceBaseUnits + action.amountBaseUnits,
          ],
        }),
      },
      {
        to: current.contractAddress,
        data: encodeFunctionData({
          abi: escrowV3Abi,
          functionName: "repayLoanPartial",
          args: [
            BigInt(action.loan.chainLoanId),
            action.amountBaseUnits,
            action.chainRepaymentId as `0x${string}`,
          ],
        }),
      },
    ],
  };
}

export async function confirmRepaymentApproval(
  actor: AuthenticatedActor,
  actionId: string,
  transactionHash: `0x${string}`,
) {
  const current = runtime();
  const { borrower, wallet, action } = await approvalAction(actor, actionId);
  if (action.status === "CONFIRMED")
    return { status: "CONFIRMED" as const, runFollowUp: false };
  if (
    action.status !== "AWAITING_APPROVAL" ||
    !action.loan.chainLoanId ||
    !action.loan.lenderWalletAddress
  ) {
    throw new ApplicationError(
      "APPROVAL_NOT_OPEN",
      "This approval request is no longer open.",
      409,
    );
  }
  const receipt = await receiptFor(current, transactionHash);
  const verified =
    receipt.status === "success"
      ? verifyRepaymentLogs(receipt.logs, {
          contractAddress: current.contractAddress,
          usdcAddress: ARC_USDC_ADDRESS,
          chainLoanId: action.loan.chainLoanId,
          chainRepaymentId: action.chainRepaymentId,
          amountBaseUnits: action.amountBaseUnits ?? 0n,
          borrower: wallet,
          lender: action.loan.lenderWalletAddress,
          agent: null,
        })
      : { verified: false as const, checks: [] };
  if (!verified.verified) {
    throw new ApplicationError(
      "APPROVAL_NOT_VERIFIED",
      "The transaction does not match the approved repayment.",
      400,
    );
  }
  const block = await current.publicClient.getBlock({
    blockNumber: receipt.blockNumber,
  });
  const paidAt = new Date(Number(block.timestamp) * 1_000);
  await prisma.$transaction(async (transaction) => {
    await settleVerifiedRepayment(transaction, {
      organizationId: borrower.organizationId,
      loanId: action.loanId,
      repaymentRequestId: action.repaymentRequestId,
      transactionHash,
      amountBaseUnits: action.amountBaseUnits ?? 0n,
      remainingBaseUnits: verified.remainingBaseUnits,
      paidAt,
      actorMembershipId: borrower.borrowerMembershipId,
      source: "BORROWER_APPROVAL",
    });
    await transaction.repaymentAgentAction.update({
      where: { id: action.id },
      data: {
        status: "CONFIRMED",
        transactionHash: transactionHash.toLowerCase(),
        confirmedAt: new Date(),
        verification: toJsonSafe(verified) as object,
      },
    });
    const lastStep = await transaction.repaymentAgentStep.findFirst({
      where: { runId: action.runId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    await transaction.repaymentAgentStep.create({
      data: {
        organizationId: borrower.organizationId,
        runId: action.runId,
        sequence: (lastStep?.sequence ?? 0) + 1,
        phase: "VERIFY",
        name: "HUMAN_APPROVAL_VERIFIED",
        summary:
          "The borrower approved the request with their passkey; the on-chain repayment was verified and recorded.",
        data: toJsonSafe({
          transactionHash,
          checks: verified.checks,
        }) as object,
      },
    });
    await transaction.repaymentAgentRun.update({
      where: { id: action.runId },
      data: { status: "COMPLETED", outcomeCode: "APPROVED_BY_BORROWER" },
    });
  });
  return {
    status: "CONFIRMED" as const,
    runFollowUp: true,
    borrower,
    parentRunId: action.runId,
  };
}

export async function runApprovalFollowUp(
  borrower: BorrowerRef,
  parentRunId: string,
) {
  return runRepaymentAgent(
    borrower,
    "APPROVAL_FOLLOW_UP",
    createRepaymentAgentDependencies(),
    {
      parentRunId,
    },
  );
}

const runSelection = {
  id: true,
  trigger: true,
  status: true,
  plannerKind: true,
  plannerModel: true,
  outcomeCode: true,
  outcomeSummary: true,
  requiresHumanApproval: true,
  startedAt: true,
  completedAt: true,
  steps: {
    orderBy: { sequence: "asc" as const },
    select: {
      sequence: true,
      phase: true,
      name: true,
      summary: true,
      data: true,
    },
  },
  actions: {
    select: {
      id: true,
      action: true,
      amountBaseUnits: true,
      status: true,
      transactionHash: true,
      failureCode: true,
    },
  },
};

function serializeRun(run: {
  id: string;
  trigger: string;
  status: string;
  plannerKind: string;
  plannerModel: string | null;
  outcomeCode: string | null;
  outcomeSummary: string | null;
  requiresHumanApproval: boolean;
  startedAt: Date;
  completedAt: Date | null;
  steps: Array<{
    sequence: number;
    phase: string;
    name: string;
    summary: string;
    data: unknown;
  }>;
  actions: Array<{
    id: string;
    action: string;
    amountBaseUnits: bigint | null;
    status: string;
    transactionHash: string | null;
    failureCode: string | null;
  }>;
}) {
  return {
    ...run,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    actions: run.actions.map((action) => ({
      ...action,
      amountBaseUnits: action.amountBaseUnits?.toString() ?? null,
    })),
  };
}

export type SerializedAgentRun = ReturnType<typeof serializeRun>;

export async function getRepaymentAgentOverview(actor: AuthenticatedActor) {
  const { borrower, walletAddress } = await borrowerContext(actor);
  let current: Runtime | null = null;
  let configurationIssue: string | null = null;
  try {
    current = runtime();
  } catch (error) {
    configurationIssue =
      error instanceof ApplicationError
        ? error.message
        : "The repayment agent is unavailable.";
  }
  const [record, approvals, runs] = await Promise.all([
    prisma.repaymentAgentMandate.findFirst({
      where: {
        borrowerMembershipId: borrower.borrowerMembershipId,
        status: "ACTIVE",
      },
      orderBy: { activatedAt: "desc" },
    }),
    prisma.repaymentAgentAction.findMany({
      where: {
        borrowerMembershipId: borrower.borrowerMembershipId,
        status: "AWAITING_APPROVAL",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        loanId: true,
        amountBaseUnits: true,
        expiresAt: true,
        decision: true,
      },
    }),
    prisma.repaymentAgentRun.findMany({
      where: {
        organizationId: borrower.organizationId,
        borrowerMembershipId: borrower.borrowerMembershipId,
      },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: runSelection,
    }),
  ]);
  let onChain = null;
  if (current && walletAddress) {
    try {
      const state = await current.gateway.readBorrowerState(walletAddress);
      onChain = toJsonSafe(state) as Record<string, unknown>;
    } catch (error) {
      logger.warn("Repayment agent chain read failed", {
        error: String(error),
      });
    }
  }
  return {
    enabled: current !== null,
    configurationIssue,
    agentAddress: current?.gateway.agentAddress ?? null,
    contractAddress: current?.contractAddress ?? null,
    planner: current
      ? { kind: current.planner.kind, model: current.planner.model }
      : null,
    walletAddress,
    onChain,
    mandate: record
      ? {
          id: record.id,
          maxPerRepaymentBaseUnits: record.maxPerRepaymentBaseUnits.toString(),
          maxPerPeriodBaseUnits: record.maxPerPeriodBaseUnits.toString(),
          minimumReserveBaseUnits: record.minimumReserveBaseUnits.toString(),
          earliestBeforeDueSeconds: record.earliestBeforeDueSeconds,
          expiresAt: record.expiresAt.toISOString(),
          chainNonce: record.chainNonce,
          transactionHash: record.transactionHash,
        }
      : null,
    approvals: approvals.map((approval) => ({
      id: approval.id,
      loanId: approval.loanId,
      amountBaseUnits: approval.amountBaseUnits?.toString() ?? "0",
      expiresAt: approval.expiresAt?.toISOString() ?? null,
      explanation:
        (approval.decision as { explanation?: string } | null)?.explanation ??
        "",
    })),
    runs: runs.map(serializeRun),
  };
}

export type RepaymentAgentOverview = Awaited<
  ReturnType<typeof getRepaymentAgentOverview>
>;

/**
 * Employer read model: agent actions on one of the organization's loans.
 * Deliberately excludes the borrower's wallet balance, reasoning log and
 * explanations, which describe the employee's personal finances.
 */
export async function listAgentActivityForLoan(
  actor: AuthenticatedActor,
  loanId: string,
) {
  const employer = requireEmployerAdmin(actor);
  const actions = await prisma.repaymentAgentAction.findMany({
    where: { organizationId: employer.organizationId, loanId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      action: true,
      amountBaseUnits: true,
      status: true,
      transactionHash: true,
      createdAt: true,
      confirmedAt: true,
    },
  });
  return actions.map((action) => ({
    ...action,
    amountBaseUnits: action.amountBaseUnits?.toString() ?? null,
    createdAt: action.createdAt.toISOString(),
    confirmedAt: action.confirmedAt?.toISOString() ?? null,
  }));
}
