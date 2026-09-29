import "dotenv/config";

import { randomUUID } from "node:crypto";

import { prisma } from "../src/infrastructure/database/prisma";
import {
  fundEmployeeWallet,
  loadWallet,
} from "../src/modules/ledger/infrastructure/prisma-wallet-repository";
import {
  ensureUserWallet,
  lockLedgerAccounts,
  postLedgerTransaction,
} from "../src/modules/ledger/infrastructure/ledger-posting";
import { prismaBorrowLoanRepository } from "../src/modules/loans/infrastructure/prisma-borrow-loan-repository";
import { prismaEmployeeLoanRepository } from "../src/modules/loans/infrastructure/prisma-employee-loan-repository";

const suffix = randomUUID();
const organizationIds: string[] = [];
const userIds: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function balance(organizationId: string, userId: string) {
  const wallet = await loadWallet({ organizationId, userId });
  assert(wallet, "Employee wallet was not provisioned.");
  return wallet.availableBalanceMinorUnits;
}

try {
  const organization = await prisma.organization.create({
    data: {
      name: "Ledger verification",
      slug: `ledger-${suffix}`,
      currency: "USD",
    },
  });
  organizationIds.push(organization.id);
  const users = await Promise.all(
    ["Alice", "Bob", "Charlie"].map((name) =>
      prisma.user.create({
        data: {
          email: `${name.toLowerCase()}-${suffix}@ledger.test`,
          name,
          passwordHash: "unused",
        },
      }),
    ),
  );
  userIds.push(...users.map(({ id }) => id));
  const [alice, bob, charlie] = users;
  assert(alice && bob && charlie, "Verification users missing.");
  const memberships = await Promise.all(
    users.map((user) =>
      prisma.organizationMembership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: "EMPLOYEE",
        },
      }),
    ),
  );
  const [aliceMembership, , charlieMembership] = memberships;
  assert(
    aliceMembership && charlieMembership,
    "Verification memberships missing.",
  );

  const aliceFundingId = randomUUID();
  const firstFunding = await fundEmployeeWallet({
    organizationId: organization.id,
    userId: alice.id,
    amountMinorUnits: 50_000n,
    requestId: aliceFundingId,
    now: new Date(),
  });
  const duplicateFunding = await fundEmployeeWallet({
    organizationId: organization.id,
    userId: alice.id,
    amountMinorUnits: 50_000n,
    requestId: aliceFundingId,
    now: new Date(),
  });
  assert(
    firstFunding && duplicateFunding?.alreadyPosted,
    "Funding was not idempotent.",
  );
  assert(
    (await balance(organization.id, alice.id)) === 50_000n,
    "Funding balance is wrong.",
  );

  const offer = await prisma.lendingOffer.create({
    data: {
      organizationId: organization.id,
      lenderMembershipId: aliceMembership.id,
      amountMinorUnits: 50_000n,
      availableAmountMinorUnits: 50_000n,
      minimumLoanAmountMinorUnits: 100n,
      maximumLoanAmountMinorUnits: 50_000n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 300,
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "ACTIVE",
    },
  });
  assert(
    (await balance(organization.id, alice.id)) === 50_000n,
    "Creating an offer moved wallet funds.",
  );
  const borrowRequestId = randomUUID();
  const borrowInput = {
    organizationId: organization.id,
    userId: bob.id,
    command: {
      offerId: offer.id,
      amountMinorUnits: 5_000n,
      requestId: borrowRequestId,
    },
    now: new Date(),
  };
  const borrowed =
    await prismaBorrowLoanRepository.createFromOffer(borrowInput);
  assert(borrowed.kind === "CREATED", "Loan disbursement failed.");
  const borrowRetry =
    await prismaBorrowLoanRepository.createFromOffer(borrowInput);
  assert(
    borrowRetry.kind === "ALREADY_CREATED",
    "Borrow retry was not idempotent.",
  );
  assert(
    (await balance(organization.id, alice.id)) === 45_000n,
    "Lender was not debited.",
  );
  assert(
    (await balance(organization.id, bob.id)) === 5_000n,
    "Borrower was not credited.",
  );
  assert(
    (await prisma.ledgerTransaction.count({
      where: {
        organizationId: organization.id,
        type: "LOAN_DISBURSEMENT",
        referenceType: "LOAN",
        referenceId: borrowed.loan.id,
        status: "COMPLETED",
      },
    })) === 1,
    "Loan and ledger disbursement were not created atomically.",
  );

  await fundEmployeeWallet({
    organizationId: organization.id,
    userId: bob.id,
    amountMinorUnits: 150n,
    requestId: randomUUID(),
    now: new Date(),
  });
  const firstRepayment = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId: organization.id,
    userId: bob.id,
    command: {
      loanId: borrowed.loan.id,
      amountMinorUnits: 2_000n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });
  assert(firstRepayment.kind === "RECORDED", "Partial repayment failed.");
  assert(
    (await balance(organization.id, alice.id)) === 47_000n,
    "Partial repayment did not credit lender.",
  );
  assert(
    (await balance(organization.id, bob.id)) === 3_150n,
    "Partial repayment did not debit borrower.",
  );
  const finalRepayment = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId: organization.id,
    userId: bob.id,
    command: {
      loanId: borrowed.loan.id,
      amountMinorUnits: 3_150n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });
  assert(finalRepayment.kind === "RECORDED", "Final repayment failed.");
  assert(
    (await balance(organization.id, alice.id)) === 50_150n,
    "Lender earnings are wrong.",
  );
  assert(
    (await balance(organization.id, bob.id)) === 0n,
    "Borrower final balance is wrong.",
  );
  const repaidLoan = await prisma.loan.findUniqueOrThrow({
    where: { id: borrowed.loan.id },
  });
  assert(repaidLoan.status === "REPAID", "Loan was not marked repaid.");

  const unfundedOffer = await prisma.lendingOffer.create({
    data: {
      organizationId: organization.id,
      lenderMembershipId: charlieMembership.id,
      amountMinorUnits: 5_000n,
      availableAmountMinorUnits: 5_000n,
      minimumLoanAmountMinorUnits: 100n,
      maximumLoanAmountMinorUnits: 5_000n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 0,
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "ACTIVE",
    },
  });
  const loanCountBefore = await prisma.loan.count({
    where: { organizationId: organization.id },
  });
  const bobBalanceBeforeFailedBorrow = await balance(organization.id, bob.id);
  const failedBorrow = await prismaBorrowLoanRepository.createFromOffer({
    organizationId: organization.id,
    userId: bob.id,
    command: {
      offerId: unfundedOffer.id,
      amountMinorUnits: 5_000n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });
  assert(
    failedBorrow.kind === "INSUFFICIENT_LENDER_BALANCE",
    "Unfunded lender was accepted.",
  );
  assert(
    (await prisma.loan.count({
      where: { organizationId: organization.id },
    })) === loanCountBefore,
    "Failed borrow created a loan.",
  );
  assert(
    (await balance(organization.id, bob.id)) === bobBalanceBeforeFailedBorrow,
    "Failed borrow changed a wallet balance.",
  );

  await fundEmployeeWallet({
    organizationId: organization.id,
    userId: charlie.id,
    amountMinorUnits: 5_000n,
    requestId: randomUUID(),
    now: new Date(),
  });
  await prisma.lendingOffer.update({
    where: { id: unfundedOffer.id },
    data: {
      availableAmountMinorUnits: 10_000n,
      amountMinorUnits: 10_000n,
      maximumLoanAmountMinorUnits: 10_000n,
    },
  });
  const concurrent = await Promise.all(
    [alice, bob].map((borrower) =>
      prismaBorrowLoanRepository.createFromOffer({
        organizationId: organization.id,
        userId: borrower.id,
        command: {
          offerId: unfundedOffer.id,
          amountMinorUnits: 5_000n,
          requestId: randomUUID(),
        },
        now: new Date(),
      }),
    ),
  );
  assert(
    concurrent.filter(({ kind }) => kind === "CREATED").length === 1,
    "Concurrent spend allowed more than one loan.",
  );
  assert(
    concurrent.filter(({ kind }) => kind === "INSUFFICIENT_LENDER_BALANCE")
      .length === 1,
    "Concurrent spend did not reject insufficient funds.",
  );
  assert(
    (await balance(organization.id, charlie.id)) === 0n,
    "Concurrent lender balance is wrong.",
  );

  const insufficientRepaymentOffer = await prisma.lendingOffer.create({
    data: {
      organizationId: organization.id,
      lenderMembershipId: aliceMembership.id,
      amountMinorUnits: 100n,
      availableAmountMinorUnits: 100n,
      minimumLoanAmountMinorUnits: 100n,
      maximumLoanAmountMinorUnits: 100n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 300,
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "ACTIVE",
    },
  });
  const smallBorrow = await prismaBorrowLoanRepository.createFromOffer({
    organizationId: organization.id,
    userId: bob.id,
    command: {
      offerId: insufficientRepaymentOffer.id,
      amountMinorUnits: 100n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });
  assert(
    smallBorrow.kind === "CREATED",
    "Insufficient-repayment fixture loan failed.",
  );
  const repaymentCountBefore = await prisma.loanRepayment.count({
    where: { loanId: smallBorrow.loan.id },
  });
  const bobBalanceBeforeFailedRepayment = await balance(
    organization.id,
    bob.id,
  );
  const failedRepayment = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId: organization.id,
    userId: bob.id,
    command: {
      loanId: smallBorrow.loan.id,
      amountMinorUnits: 103n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });
  assert(
    failedRepayment.kind === "INSUFFICIENT_BALANCE",
    "Unfunded repayment was accepted.",
  );
  assert(
    (await prisma.loanRepayment.count({
      where: { loanId: smallBorrow.loan.id },
    })) === repaymentCountBefore,
    "Failed repayment created a repayment record.",
  );
  assert(
    (await balance(organization.id, bob.id)) ===
      bobBalanceBeforeFailedRepayment,
    "Failed repayment changed the borrower balance.",
  );

  const completed = await prisma.ledgerTransaction.findMany({
    where: { organizationId: organization.id, status: "COMPLETED" },
    include: { entries: true },
  });
  for (const posting of completed) {
    const assets = new Set(posting.entries.map(({ asset }) => asset));
    for (const asset of assets) {
      const entries = posting.entries.filter((entry) => entry.asset === asset);
      const debits = entries
        .filter(({ direction }) => direction === "DEBIT")
        .reduce((sum, entry) => sum + entry.amountMinorUnits, 0n);
      const credits = entries
        .filter(({ direction }) => direction === "CREDIT")
        .reduce((sum, entry) => sum + entry.amountMinorUnits, 0n);
      assert(
        debits === credits,
        `Unbalanced ${asset} transaction ${posting.id}.`,
      );
    }
  }
  const history = await loadWallet({
    organizationId: organization.id,
    userId: alice.id,
  });
  assert(
    history && history.transactions.some(({ type }) => type === "DEPOSIT"),
    "Wallet history omitted deposit.",
  );
  assert(
    history.transactions.some(({ type }) => type === "LOAN_DISBURSEMENT"),
    "Wallet history omitted disbursement.",
  );
  assert(
    history.transactions.some(({ type }) => type === "LOAN_REPAYMENT"),
    "Wallet history omitted repayment.",
  );
  for (const user of users) {
    assert(
      (await balance(organization.id, user.id)) >= 0n,
      `Wallet became negative for ${user.name}.`,
    );
  }

  const immutableEntry = completed[0]?.entries[0];
  assert(immutableEntry, "No completed ledger entry found.");
  let immutable = false;
  try {
    await prisma.ledgerEntry.update({
      where: { id: immutableEntry.id },
      data: { amountMinorUnits: { increment: 1n } },
    });
  } catch {
    immutable = true;
  }
  assert(immutable, "Completed ledger entry was mutable.");

  const otherOrganization = await prisma.organization.create({
    data: {
      name: "Other ledger tenant",
      slug: `other-ledger-${suffix}`,
      currency: "USD",
    },
  });
  organizationIds.push(otherOrganization.id);
  const otherUser = await prisma.user.create({
    data: {
      email: `other-${suffix}@ledger.test`,
      name: "Other",
      passwordHash: "unused",
    },
  });
  userIds.push(otherUser.id);
  const otherMembership = await prisma.organizationMembership.create({
    data: {
      organizationId: otherOrganization.id,
      userId: otherUser.id,
      role: "EMPLOYEE",
    },
  });
  const aliceWallet = await loadWallet({
    organizationId: organization.id,
    userId: alice.id,
  });
  assert(aliceWallet, "Alice wallet missing.");
  let crossTenantRejected = false;
  await prisma.$transaction(async (transaction) => {
    const aliceAccount = await ensureUserWallet(transaction, {
      organizationId: organization.id,
      membershipId: aliceMembership.id,
    });
    const otherAccount = await ensureUserWallet(transaction, {
      organizationId: otherOrganization.id,
      membershipId: otherMembership.id,
    });
    try {
      await lockLedgerAccounts(transaction, organization.id, [
        aliceAccount.id,
        otherAccount.id,
      ]);
      await postLedgerTransaction(transaction, {
        organizationId: organization.id,
        type: "WITHDRAWAL",
        referenceType: "WITHDRAWAL",
        referenceId: randomUUID(),
        idempotencyKey: randomUUID(),
        now: new Date(),
        accountsAlreadyLocked: true,
        entries: [
          {
            accountId: aliceAccount.id,
            direction: "DEBIT",
            amountMinorUnits: 1n,
          },
          {
            accountId: otherAccount.id,
            direction: "CREDIT",
            amountMinorUnits: 1n,
          },
        ],
      });
    } catch {
      crossTenantRejected = true;
    }
  });
  assert(crossTenantRejected, "Cross-organization transfer was accepted.");

  console.log(
    "Ledger invariants, wallet balances, atomic loan flows, idempotency, isolation, concurrency, immutability, history, and end-to-end earnings verified.",
  );
} finally {
  for (const organizationId of organizationIds.reverse()) {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('app.allow_ledger_cleanup', 'on', true)`;
      await transaction.auditEvent.deleteMany({ where: { organizationId } });
      await transaction.ledgerEntry.deleteMany({ where: { organizationId } });
      await transaction.ledgerTransaction.deleteMany({
        where: { organizationId },
      });
      await transaction.loanRepayment.deleteMany({ where: { organizationId } });
      await transaction.loan.deleteMany({ where: { organizationId } });
      await transaction.lendingOffer.deleteMany({ where: { organizationId } });
      await transaction.ledgerAccount.deleteMany({ where: { organizationId } });
      await transaction.employeeBalance.deleteMany({
        where: { organizationId },
      });
      await transaction.organization.deleteMany({
        where: { id: organizationId },
      });
    });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
}
