import "server-only";

import {
  ContractAddress,
  encodeTransfer,
  toModularTransport,
} from "@circle-fin/modular-wallets-core";
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { createBundlerClient } from "viem/account-abstraction";

import { prisma } from "@/infrastructure/database/prisma";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  ARC_TESTNET_RPC_URL,
  ARC_USDC_ADDRESS,
  ARC_USDC_DECIMALS,
  arcTestnet,
  getArcModularClientUrl,
} from "@/integrations/arc/arc-testnet";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  hasExactSingleOutgoingUsdcTransfer,
  normalizeArcTransferRecipient,
} from "@/modules/arc-wallet/domain/arc-usdc-transfer";
import { parseUsdcBaseUnits } from "@/modules/arc-wallet/schemas/arc-usdc-transfer.schema";
import { ApplicationError } from "@/shared/errors/application-error";

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC_URL),
});
const INTENT_TTL_MS = 10 * 60 * 1000;

function transferError(code: string, message: string, statusCode = 400) {
  return new ApplicationError(code, message, statusCode);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function findTransferForActor(actor: AuthenticatedActor, id: string) {
  return prisma.arcUsdcTransfer.findFirst({
    where: { id, userId: actor.userId, organizationId: actor.organizationId },
  });
}

type TransferRow = NonNullable<
  Awaited<ReturnType<typeof findTransferForActor>>
>;

function serializeTransfer(transfer: TransferRow) {
  return {
    id: transfer.id,
    status: transfer.status,
    senderAddress: transfer.senderAddress,
    recipientAddress: transfer.recipientAddress,
    amount: formatUnits(transfer.amountBaseUnits, ARC_USDC_DECIMALS),
    amountBaseUnits: transfer.amountBaseUnits.toString(),
    chainId: transfer.chainId,
    network: "Arc Testnet" as const,
    token: "USDC" as const,
    tokenAddress: transfer.tokenAddress,
    userOperationHash: transfer.userOperationHash,
    transactionHash: transfer.transactionHash,
    explorerUrl: transfer.transactionHash
      ? `${arcTestnet.blockExplorers.default.url}/tx/${transfer.transactionHash}`
      : null,
    errorCode: transfer.errorCode,
    createdAt: transfer.createdAt.toISOString(),
    submittedAt: transfer.submittedAt?.toISOString() ?? null,
    confirmedAt: transfer.confirmedAt?.toISOString() ?? null,
  };
}

async function requireTransferForActor(actor: AuthenticatedActor, id: string) {
  const transfer = await findTransferForActor(actor, id);
  if (!transfer) {
    throw transferError("ARC_TRANSFER_NOT_FOUND", "Transfer not found.", 404);
  }
  return transfer;
}

async function verifyArcConfiguration(sender: Address) {
  const [chainId, decimals, balance] = await Promise.all([
    publicClient.getChainId(),
    publicClient.readContract({
      address: ARC_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: ARC_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [sender],
    }),
  ]);
  if (chainId !== ARC_TESTNET_CHAIN_ID) {
    throw transferError(
      "ARC_NETWORK_UNAVAILABLE",
      "The configured RPC is not connected to Arc Testnet.",
      503,
    );
  }
  if (
    decimals !== ARC_USDC_DECIMALS ||
    ContractAddress.ArcTestnet_USDC.toLowerCase() !==
      ARC_USDC_ADDRESS.toLowerCase()
  ) {
    throw transferError(
      "ARC_USDC_CONFIGURATION_INVALID",
      "The official Arc Testnet USDC configuration could not be verified.",
      503,
    );
  }
  return balance;
}

export async function prepareArcUsdcTransfer(
  actor: AuthenticatedActor,
  input: {
    idempotencyKey: string;
    recipient: string;
    amount: string;
    chainId: number;
    tokenAddress: string;
  },
) {
  if (
    input.chainId !== ARC_TESTNET_CHAIN_ID ||
    input.tokenAddress.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()
  ) {
    throw transferError(
      "ARC_TRANSFER_ASSET_NOT_ALLOWED",
      "Only official USDC on Arc Testnet can be sent.",
    );
  }
  let recipient: Address;
  try {
    recipient = normalizeArcTransferRecipient(input.recipient).recipient;
  } catch {
    throw transferError(
      "ARC_TRANSFER_RECIPIENT_INVALID",
      "Enter a valid EVM wallet address.",
    );
  }
  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = parseUsdcBaseUnits(input.amount);
  } catch {
    throw transferError(
      "ARC_TRANSFER_AMOUNT_INVALID",
      "Enter a positive USDC amount with no more than 6 decimal places.",
    );
  }

  const wallet = await prisma.arcWallet.findFirst({
    where: {
      userId: actor.userId,
      network: ARC_TESTNET_NETWORK,
      status: "ACTIVE",
      chainId: ARC_TESTNET_CHAIN_ID,
      address: { not: null },
    },
  });
  if (!wallet?.address) {
    throw transferError(
      "ARC_WALLET_NOT_READY",
      "Reconnect your active Arc Testnet wallet before sending USDC.",
      409,
    );
  }
  const sender = getAddress(wallet.address);
  const balance = await verifyArcConfiguration(sender);
  if (amountBaseUnits > balance) {
    throw transferError(
      "ARC_TRANSFER_INSUFFICIENT_USDC",
      "The transfer amount exceeds the current USDC balance.",
      422,
    );
  }

  const call = encodeTransfer(
    recipient,
    ContractAddress.ArcTestnet_USDC,
    amountBaseUnits,
  );
  if (call.to.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) {
    throw transferError(
      "ARC_USDC_CONFIGURATION_INVALID",
      "The Circle SDK token configuration does not match Arc Testnet.",
      503,
    );
  }
  const callDataHash = keccak256(call.data);
  const existing = await prisma.arcUsdcTransfer.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: actor.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    if (
      existing.organizationId !== actor.organizationId ||
      existing.walletId !== wallet.id ||
      existing.recipientAddress.toLowerCase() !== recipient.toLowerCase() ||
      existing.amountBaseUnits !== amountBaseUnits ||
      existing.callDataHash !== callDataHash
    ) {
      throw transferError(
        "ARC_TRANSFER_IDEMPOTENCY_CONFLICT",
        "This transfer request identifier is already bound to different details.",
        409,
      );
    }
    return {
      transfer: serializeTransfer(existing),
      call: { to: call.to, data: call.data, value: "0" },
      selfTransfer: sender.toLowerCase() === recipient.toLowerCase(),
      availableBalance: formatUnits(balance, ARC_USDC_DECIMALS),
      fee: { kind: "SPONSORED" as const, amount: "0", token: "USDC" as const },
    };
  }

  let transfer;
  try {
    transfer = await prisma.arcUsdcTransfer.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        walletId: wallet.id,
        idempotencyKey: input.idempotencyKey,
        senderAddress: sender.toLowerCase(),
        recipientAddress: recipient.toLowerCase(),
        amountBaseUnits,
        chainId: ARC_TESTNET_CHAIN_ID,
        tokenAddress: ARC_USDC_ADDRESS.toLowerCase(),
        callDataHash,
        status: "AWAITING_CONFIRMATION",
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await prisma.arcUsdcTransfer.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: actor.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (
      !raced ||
      raced.organizationId !== actor.organizationId ||
      raced.walletId !== wallet.id ||
      raced.recipientAddress.toLowerCase() !== recipient.toLowerCase() ||
      raced.amountBaseUnits !== amountBaseUnits ||
      raced.callDataHash !== callDataHash
    ) {
      throw transferError(
        "ARC_TRANSFER_IDEMPOTENCY_CONFLICT",
        "A transfer with this request identifier already exists.",
        409,
      );
    }
    transfer = raced;
  }
  return {
    transfer: serializeTransfer(transfer),
    call: { to: call.to, data: call.data, value: "0" },
    selfTransfer: sender.toLowerCase() === recipient.toLowerCase(),
    availableBalance: formatUnits(balance, ARC_USDC_DECIMALS),
    fee: { kind: "SPONSORED" as const, amount: "0", token: "USDC" as const },
  };
}

export async function bindArcUsdcUserOperation(
  actor: AuthenticatedActor,
  id: string,
  userOperationHash: Hex,
) {
  const transfer = await requireTransferForActor(actor, id);
  if (transfer.userOperationHash) {
    if (
      transfer.userOperationHash.toLowerCase() !==
      userOperationHash.toLowerCase()
    ) {
      throw transferError(
        "ARC_TRANSFER_SUBMISSION_CONFLICT",
        "This transfer is already bound to a different Circle operation.",
        409,
      );
    }
    return serializeTransfer(transfer);
  }
  if (transfer.status !== "AWAITING_CONFIRMATION") {
    throw transferError(
      "ARC_TRANSFER_NOT_CONFIRMABLE",
      "This transfer can no longer be submitted.",
      409,
    );
  }
  if (transfer.expiresAt <= new Date()) {
    await prisma.arcUsdcTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "FAILED",
        errorCode: "INTENT_EXPIRED",
        failedAt: new Date(),
      },
    });
    throw transferError(
      "ARC_TRANSFER_INTENT_EXPIRED",
      "The review expired. Review the current balance and transfer again.",
      409,
    );
  }
  try {
    const updated = await prisma.arcUsdcTransfer.updateMany({
      where: {
        id: transfer.id,
        status: "AWAITING_CONFIRMATION",
        userOperationHash: null,
      },
      data: {
        status: "SUBMITTED",
        userOperationHash: userOperationHash.toLowerCase(),
        submittedAt: new Date(),
      },
    });
    if (updated.count === 1) {
      return serializeTransfer(await requireTransferForActor(actor, id));
    }
    const raced = await requireTransferForActor(actor, id);
    if (
      raced.userOperationHash?.toLowerCase() === userOperationHash.toLowerCase()
    ) {
      return serializeTransfer(raced);
    }
    throw transferError(
      "ARC_TRANSFER_SUBMISSION_CONFLICT",
      "This transfer is already bound to a different Circle operation.",
      409,
    );
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    if (!isUniqueConstraintError(error)) throw error;
    throw transferError(
      "ARC_TRANSFER_SUBMISSION_CONFLICT",
      "That Circle operation is already associated with another transfer.",
      409,
    );
  }
}

export async function revalidateArcUsdcTransfer(
  actor: AuthenticatedActor,
  id: string,
) {
  const transfer = await requireTransferForActor(actor, id);
  if (
    transfer.status !== "AWAITING_CONFIRMATION" ||
    transfer.expiresAt <= new Date()
  ) {
    throw transferError(
      "ARC_TRANSFER_NOT_CONFIRMABLE",
      "This transfer must be reviewed again before signing.",
      409,
    );
  }
  const wallet = await prisma.arcWallet.findFirst({
    where: {
      id: transfer.walletId,
      userId: actor.userId,
      status: "ACTIVE",
      network: ARC_TESTNET_NETWORK,
      chainId: ARC_TESTNET_CHAIN_ID,
      address: transfer.senderAddress,
    },
  });
  if (!wallet?.address) {
    throw transferError(
      "ARC_WALLET_NOT_READY",
      "The enrolled Arc Testnet wallet is no longer available.",
      409,
    );
  }
  const balance = await verifyArcConfiguration(getAddress(wallet.address));
  if (transfer.amountBaseUnits > balance) {
    throw transferError(
      "ARC_TRANSFER_INSUFFICIENT_USDC",
      "The current USDC balance is no longer sufficient for this transfer.",
      422,
    );
  }
  const call = encodeTransfer(
    getAddress(transfer.recipientAddress),
    ContractAddress.ArcTestnet_USDC,
    transfer.amountBaseUnits,
  );
  if (
    call.to.toLowerCase() !== transfer.tokenAddress.toLowerCase() ||
    keccak256(call.data) !== transfer.callDataHash
  ) {
    throw transferError(
      "ARC_TRANSFER_INTENT_MISMATCH",
      "The approved transfer details could not be reproduced safely.",
      409,
    );
  }
  return {
    transfer: serializeTransfer(transfer),
    call: { to: call.to, data: call.data, value: "0" },
    selfTransfer:
      transfer.senderAddress.toLowerCase() ===
      transfer.recipientAddress.toLowerCase(),
    availableBalance: formatUnits(balance, ARC_USDC_DECIMALS),
    fee: { kind: "SPONSORED" as const, amount: "0", token: "USDC" as const },
  };
}

export async function recordArcUsdcTransferOutcome(
  actor: AuthenticatedActor,
  id: string,
  outcome: "REJECTED" | "UNKNOWN",
) {
  const transfer = await requireTransferForActor(actor, id);
  if (transfer.status !== "AWAITING_CONFIRMATION")
    return serializeTransfer(transfer);
  const now = new Date();
  return serializeTransfer(
    await prisma.arcUsdcTransfer.update({
      where: { id: transfer.id },
      data:
        outcome === "REJECTED"
          ? { status: "FAILED", errorCode: "USER_REJECTED", failedAt: now }
          : { status: "UNKNOWN", errorCode: "SUBMISSION_OUTCOME_UNKNOWN" },
    }),
  );
}

export async function confirmArcUsdcTransfer(
  actor: AuthenticatedActor,
  id: string,
  transactionHash: Hex,
) {
  const transfer = await requireTransferForActor(actor, id);
  if (transfer.transactionHash) {
    if (
      transfer.transactionHash.toLowerCase() !== transactionHash.toLowerCase()
    ) {
      throw transferError(
        "ARC_TRANSFER_CONFIRMATION_CONFLICT",
        "This transfer is already bound to a different Arc transaction.",
        409,
      );
    }
    return serializeTransfer(transfer);
  }
  if (!transfer.userOperationHash) {
    throw transferError(
      "ARC_TRANSFER_NOT_SUBMITTED",
      "The Circle operation must be recorded before confirmation.",
      409,
    );
  }
  const circleReceipt = await lookupCircleReceipt(
    transfer.userOperationHash as Hex,
  );
  if (!circleReceipt) {
    throw transferError(
      "ARC_TRANSFER_RECEIPT_PENDING",
      "Circle has not returned a receipt for this operation yet.",
      409,
    );
  }
  if (
    circleReceipt.receipt.transactionHash.toLowerCase() !==
    transactionHash.toLowerCase()
  ) {
    throw transferError(
      "ARC_TRANSFER_TRANSACTION_BINDING_INVALID",
      "The Arc transaction does not belong to the recorded Circle operation.",
      409,
    );
  }
  const receipt = await publicClient.getTransactionReceipt({
    hash: transactionHash,
  });
  if (receipt.status !== "success") {
    return serializeTransfer(
      await prisma.arcUsdcTransfer.update({
        where: { id: transfer.id },
        data: {
          status: "FAILED",
          transactionHash: transactionHash.toLowerCase(),
          errorCode: "FAILED_ONCHAIN",
          failedAt: new Date(),
        },
      }),
    );
  }
  if (
    !hasExactSingleOutgoingUsdcTransfer(receipt.logs, {
      sender: transfer.senderAddress,
      recipient: transfer.recipientAddress,
      amountBaseUnits: transfer.amountBaseUnits,
    })
  ) {
    await prisma.arcUsdcTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "FAILED",
        transactionHash: transactionHash.toLowerCase(),
        errorCode: "TRANSACTION_MISMATCH",
        failedAt: new Date(),
      },
    });
    throw transferError(
      "ARC_TRANSFER_TRANSACTION_MISMATCH",
      "The on-chain transaction does not exactly match the approved transfer.",
      409,
    );
  }
  return serializeTransfer(
    await prisma.arcUsdcTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "CONFIRMED",
        transactionHash: transactionHash.toLowerCase(),
        errorCode: null,
        confirmedAt: new Date(),
      },
    }),
  );
}

async function lookupCircleReceipt(userOperationHash: Hex) {
  const clientKey = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
  const clientUrl = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL;
  if (!clientKey || !clientUrl) return null;
  const transport = toModularTransport(
    getArcModularClientUrl(clientUrl),
    clientKey,
  );
  const bundler = createBundlerClient({ chain: arcTestnet, transport });
  try {
    return await bundler.getUserOperationReceipt({ hash: userOperationHash });
  } catch {
    return null;
  }
}

export async function getArcUsdcTransfer(
  actor: AuthenticatedActor,
  id: string,
) {
  let transfer = await requireTransferForActor(actor, id);
  if (
    transfer.status === "AWAITING_CONFIRMATION" &&
    transfer.expiresAt <= new Date()
  ) {
    transfer = await prisma.arcUsdcTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "FAILED",
        errorCode: "INTENT_EXPIRED",
        failedAt: new Date(),
      },
    });
  }
  if (
    ["SUBMITTED", "UNKNOWN"].includes(transfer.status) &&
    transfer.userOperationHash
  ) {
    const circleReceipt = await lookupCircleReceipt(
      transfer.userOperationHash as Hex,
    );
    if (circleReceipt?.receipt.transactionHash) {
      return confirmArcUsdcTransfer(
        actor,
        id,
        circleReceipt.receipt.transactionHash,
      );
    }
  }
  return serializeTransfer(transfer);
}

export async function listArcUsdcTransfers(actor: AuthenticatedActor) {
  const transfers = await prisma.arcUsdcTransfer.findMany({
    where: { userId: actor.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return transfers.map(serializeTransfer);
}
