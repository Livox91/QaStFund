import { MembershipRole, type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { WALLET_ASSET, type Wallet } from "@/modules/ledger/domain/ledger";
import {
  ensurePlatformFundingAccount,
  ensureUserWallet,
  getCompletedAccountBalance,
  lockLedgerAccounts,
  postLedgerTransaction,
} from "@/modules/ledger/infrastructure/ledger-posting";

type TransactionClient = Prisma.TransactionClient;

async function findEmployeeMembership(
  transaction: TransactionClient,
  organizationId: string,
  userId: string,
) {
  return transaction.organizationMembership.findFirst({
    where: {
      organizationId,
      userId,
      isActive: true,
      role: MembershipRole.EMPLOYEE,
    },
    select: { id: true },
  });
}

export async function loadWallet(input: {
  organizationId: string;
  userId: string;
}): Promise<Wallet | null> {
  return prisma.$transaction(async (transaction) => {
    const membership = await findEmployeeMembership(
      transaction,
      input.organizationId,
      input.userId,
    );
    if (!membership) return null;
    const account = await ensureUserWallet(transaction, {
      organizationId: input.organizationId,
      membershipId: membership.id,
    });
    const availableBalanceMinorUnits = await getCompletedAccountBalance(
      transaction,
      {
        organizationId: input.organizationId,
        accountId: account.id,
      },
    );
    const rows = await transaction.ledgerEntry.findMany({
      where: { organizationId: input.organizationId, accountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        direction: true,
        amountMinorUnits: true,
        transaction: {
          select: {
            id: true,
            type: true,
            status: true,
            referenceType: true,
            referenceId: true,
            createdAt: true,
            completedAt: true,
          },
        },
      },
    });
    return {
      asset: WALLET_ASSET,
      availableBalanceMinorUnits,
      transactions: rows.map((row) => ({
        id: row.transaction.id,
        type: row.transaction.type,
        amountMinorUnits: row.amountMinorUnits,
        direction: row.direction === "CREDIT" ? "IN" : "OUT",
        status: row.transaction.status,
        referenceType: row.transaction.referenceType,
        referenceId: row.transaction.referenceId,
        timestamp: row.transaction.completedAt ?? row.transaction.createdAt,
      })),
    };
  });
}

export async function fundEmployeeWallet(input: {
  organizationId: string;
  userId: string;
  amountMinorUnits: bigint;
  requestId: string;
  now: Date;
}) {
  return prisma.$transaction(async (transaction) => {
    const membership = await findEmployeeMembership(
      transaction,
      input.organizationId,
      input.userId,
    );
    if (!membership) return null;
    const wallet = await ensureUserWallet(transaction, {
      organizationId: input.organizationId,
      membershipId: membership.id,
    });
    const platform = await ensurePlatformFundingAccount(
      transaction,
      input.organizationId,
    );
    await lockLedgerAccounts(transaction, input.organizationId, [
      wallet.id,
      platform.id,
    ]);
    return postLedgerTransaction(transaction, {
      organizationId: input.organizationId,
      type: "DEPOSIT",
      referenceType: "DEVELOPMENT_FUNDING",
      referenceId: input.requestId,
      idempotencyKey: `development-funding:${input.requestId}`,
      now: input.now,
      accountsAlreadyLocked: true,
      entries: [
        {
          accountId: platform.id,
          direction: "DEBIT",
          amountMinorUnits: input.amountMinorUnits,
        },
        {
          accountId: wallet.id,
          direction: "CREDIT",
          amountMinorUnits: input.amountMinorUnits,
        },
      ],
    });
  });
}
