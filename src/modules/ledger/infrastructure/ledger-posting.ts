import type { Prisma } from "@/generated/prisma/client";
import type {
  LedgerEntryDirection,
  LedgerReferenceType,
  LedgerTransactionType,
} from "@/generated/prisma/enums";
import { LedgerPostingError } from "@/modules/ledger/application/errors/ledger-errors";
import { WALLET_ASSET } from "@/modules/ledger/domain/ledger";

type TransactionClient = Prisma.TransactionClient;

export type PostingEntry = Readonly<{
  accountId: string;
  direction: LedgerEntryDirection;
  amountMinorUnits: bigint;
  asset?: typeof WALLET_ASSET;
}>;

export async function ensureUserWallet(
  transaction: TransactionClient,
  input: { organizationId: string; membershipId: string },
) {
  return transaction.ledgerAccount.upsert({
    where: {
      organizationId_membershipId_asset_type: {
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        asset: WALLET_ASSET,
        type: "USER_WALLET",
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      membershipId: input.membershipId,
      asset: WALLET_ASSET,
      type: "USER_WALLET",
    },
  });
}

export async function ensurePlatformFundingAccount(
  transaction: TransactionClient,
  organizationId: string,
) {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`platform-wallet:${organizationId}`}, 0))
  `;
  const existing = await transaction.ledgerAccount.findFirst({
    where: {
      organizationId,
      membershipId: null,
      asset: WALLET_ASSET,
      type: "PLATFORM",
    },
  });
  return (
    existing ??
    transaction.ledgerAccount.create({
      data: { organizationId, asset: WALLET_ASSET, type: "PLATFORM" },
    })
  );
}

export async function lockLedgerAccounts(
  transaction: TransactionClient,
  organizationId: string,
  accountIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(accountIds)].sort();
  if (ids.length === 0)
    throw new LedgerPostingError("No ledger accounts supplied.");
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "LedgerAccount"
    WHERE "organizationId" = CAST(${organizationId} AS UUID)
      AND "id" = ANY(${ids}::uuid[])
    ORDER BY "id"
    FOR UPDATE
  `;
  if (rows.length !== ids.length) {
    throw new LedgerPostingError(
      "Ledger accounts must belong to one organization.",
    );
  }
}

export async function getCompletedAccountBalance(
  transaction: TransactionClient,
  input: {
    organizationId: string;
    accountId: string;
    asset?: typeof WALLET_ASSET;
  },
): Promise<bigint> {
  const asset = input.asset ?? WALLET_ASSET;
  const [row] = await transaction.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(CASE
      WHEN entry."direction" = 'CREDIT' THEN entry."amountMinorUnits"
      ELSE -entry."amountMinorUnits"
    END), 0)::bigint AS balance
    FROM "LedgerEntry" AS entry
    JOIN "LedgerTransaction" AS posting ON posting."id" = entry."transactionId"
    WHERE entry."organizationId" = CAST(${input.organizationId} AS UUID)
      AND entry."accountId" = CAST(${input.accountId} AS UUID)
      AND entry."asset" = ${asset}
      AND posting."status" = 'COMPLETED'
  `;
  return row?.balance ?? 0n;
}

export async function postLedgerTransaction(
  transaction: TransactionClient,
  input: {
    organizationId: string;
    type: LedgerTransactionType;
    referenceType: LedgerReferenceType;
    referenceId: string;
    idempotencyKey: string;
    entries: readonly PostingEntry[];
    now: Date;
    accountsAlreadyLocked?: boolean;
  },
) {
  if (input.entries.length < 2) {
    throw new LedgerPostingError(
      "A ledger transaction needs at least two entries.",
    );
  }

  const totals = new Map<string, { debits: bigint; credits: bigint }>();
  for (const entry of input.entries) {
    if (entry.amountMinorUnits <= 0n) {
      throw new LedgerPostingError("Ledger entry amounts must be positive.");
    }
    const asset = entry.asset ?? WALLET_ASSET;
    const total = totals.get(asset) ?? { debits: 0n, credits: 0n };
    if (entry.direction === "DEBIT") total.debits += entry.amountMinorUnits;
    else total.credits += entry.amountMinorUnits;
    totals.set(asset, total);
  }
  for (const total of totals.values()) {
    if (total.debits !== total.credits) {
      throw new LedgerPostingError(
        "Ledger debits and credits must balance by asset.",
      );
    }
  }

  const existing = await transaction.ledgerTransaction.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    include: { entries: true },
  });
  if (existing) {
    const sameOperation =
      existing.type === input.type &&
      existing.referenceType === input.referenceType &&
      existing.referenceId === input.referenceId &&
      existing.entries.length === input.entries.length &&
      input.entries.every((requested) =>
        existing.entries.some(
          (recorded) =>
            recorded.accountId === requested.accountId &&
            recorded.direction === requested.direction &&
            recorded.amountMinorUnits === requested.amountMinorUnits &&
            recorded.asset === (requested.asset ?? WALLET_ASSET),
        ),
      );
    if (!sameOperation)
      throw new LedgerPostingError("Idempotency key conflict.");
    return { transaction: existing, alreadyPosted: true } as const;
  }

  if (!input.accountsAlreadyLocked) {
    await lockLedgerAccounts(
      transaction,
      input.organizationId,
      input.entries.map((entry) => entry.accountId),
    );
  }
  const accounts = await transaction.ledgerAccount.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: input.entries.map((entry) => entry.accountId) },
    },
    select: { id: true, asset: true },
  });
  const accountAssets = new Map(
    accounts.map((account) => [account.id, account.asset]),
  );
  if (
    accounts.length !==
      new Set(input.entries.map((entry) => entry.accountId)).size ||
    input.entries.some(
      (entry) =>
        accountAssets.get(entry.accountId) !== (entry.asset ?? WALLET_ASSET),
    )
  ) {
    throw new LedgerPostingError(
      "Ledger account organization or asset mismatch.",
    );
  }

  const posting = await transaction.ledgerTransaction.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      status: "PENDING",
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
    },
  });
  await transaction.ledgerEntry.createMany({
    data: input.entries.map((entry) => ({
      organizationId: input.organizationId,
      transactionId: posting.id,
      accountId: entry.accountId,
      direction: entry.direction,
      amountMinorUnits: entry.amountMinorUnits,
      asset: entry.asset ?? WALLET_ASSET,
    })),
  });
  const completed = await transaction.ledgerTransaction.update({
    where: { id: posting.id },
    data: { status: "COMPLETED", completedAt: input.now },
    include: { entries: true },
  });
  return { transaction: completed, alreadyPosted: false } as const;
}
