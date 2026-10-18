import "server-only";

import { prisma } from "@/infrastructure/database/prisma";
import {
  requireEmployee,
  requireEmployerAdmin,
} from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  ensurePlatformFundingAccount,
  ensureUserWallet,
  postLedgerTransaction,
} from "@/modules/ledger/infrastructure/ledger-posting";
import { calculatePrincipalReduction } from "@/modules/loans/domain/employee-loan";
import {
  escapeHtml,
  transactionalEmailHtml,
} from "@/modules/notifications/domain/transactional-email";
import { emailSender } from "@/modules/notifications/infrastructure/http-email-sender";
import {
  allocateRepaymentOldestFirst,
  deriveInstallmentState,
} from "@/modules/repayment-plans/domain/repayment-plan";
import { ApplicationError } from "@/shared/errors/application-error";

function safePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function gracePeriodMs() {
  return safePositiveInteger(process.env.REPAYMENT_GRACE_HOURS, 24) * 3_600_000;
}

function followUpDays() {
  return safePositiveInteger(process.env.REPAYMENT_FOLLOW_UP_DAYS, 7);
}

function escalationDays() {
  return safePositiveInteger(process.env.REPAYMENT_ESCALATION_DAYS, 14);
}

async function membershipForActor(actor: AuthenticatedActor) {
  const membership = await prisma.organizationMembership.findFirst({
    where: {
      organizationId: actor.organizationId,
      userId: actor.userId,
      isActive: true,
    },
    select: { id: true },
  });
  if (!membership) throw new ApplicationError("FORBIDDEN", "Forbidden.", 403);
  return membership;
}

function sumAllocations(
  allocations: ReadonlyArray<{ amountMinorUnits: bigint }>,
) {
  return allocations.reduce(
    (total, allocation) => total + allocation.amountMinorUnits,
    0n,
  );
}

export async function listPayrollDeductions(actor: AuthenticatedActor) {
  requireEmployerAdmin(actor);
  return prisma.payrollDeductionProposal.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: [{ payrollPeriodStart: "desc" }, { createdAt: "desc" }],
    include: {
      employeeMapping: { select: { externalEmployeeId: true, fullName: true } },
      installment: {
        select: {
          sequence: true,
          dueAt: true,
          amountMinorUnits: true,
          allocations: {
            where: { repayment: { status: "COMPLETED" } },
            select: { amountMinorUnits: true },
          },
        },
      },
      loan: { select: { id: true } },
    },
  });
}

export async function createPayrollDeductionProposal(
  actor: AuthenticatedActor,
  input: {
    installmentId: string;
    payrollPeriodStart: Date;
    payrollPeriodEnd: Date;
    proposedAmountMinorUnits: bigint;
    idempotencyKey: string;
  },
) {
  requireEmployerAdmin(actor);
  if (
    input.payrollPeriodEnd < input.payrollPeriodStart ||
    input.proposedAmountMinorUnits <= 0n
  ) {
    throw new ApplicationError(
      "INVALID_PAYROLL_PROPOSAL",
      "Invalid payroll proposal.",
      400,
    );
  }
  const installment = await prisma.loanInstallment.findFirst({
    where: {
      id: input.installmentId,
      organizationId: actor.organizationId,
      plan: { status: "ACTIVE" },
      loan: { status: { in: ["ACTIVE", "OVERDUE"] } },
    },
    include: {
      allocations: {
        where: { repayment: { status: "COMPLETED" } },
        select: { amountMinorUnits: true },
      },
      loan: { select: { borrowerMembershipId: true, currency: true } },
    },
  });
  if (!installment)
    throw new ApplicationError(
      "INSTALLMENT_NOT_FOUND",
      "Installment not found.",
      404,
    );
  if (
    installment.dueAt < input.payrollPeriodStart ||
    installment.dueAt > input.payrollPeriodEnd
  ) {
    throw new ApplicationError(
      "INSTALLMENT_OUTSIDE_PAYROLL_PERIOD",
      "The installment is outside the payroll period.",
      409,
    );
  }
  const mapping = await prisma.employeeDirectoryMapping.findFirst({
    where: {
      organizationId: actor.organizationId,
      matchedMembershipId: installment.loan.borrowerMembershipId,
      matchStatus: "MATCHED",
    },
    select: { id: true },
  });
  if (!mapping)
    throw new ApplicationError(
      "ERP_NEXT_EMPLOYEE_MAPPING_REQUIRED",
      "A verified ERPNext employee mapping is required.",
      409,
    );
  const paid = sumAllocations(installment.allocations);
  const outstanding = installment.amountMinorUnits - paid;
  if (outstanding <= 0n || input.proposedAmountMinorUnits > outstanding) {
    throw new ApplicationError(
      "PAYROLL_AMOUNT_EXCEEDS_OUTSTANDING",
      "The proposed deduction exceeds the installment balance.",
      409,
    );
  }
  return prisma.payrollDeductionProposal.upsert({
    where: {
      organizationId_idempotencyKey: {
        organizationId: actor.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    update: {},
    create: {
      organizationId: actor.organizationId,
      loanId: installment.loanId,
      installmentId: installment.id,
      employeeMappingId: mapping.id,
      idempotencyKey: input.idempotencyKey,
      payrollPeriodStart: input.payrollPeriodStart,
      payrollPeriodEnd: input.payrollPeriodEnd,
      scheduledAmountMinorUnits: installment.amountMinorUnits,
      outstandingAmountMinorUnits: outstanding,
      proposedAmountMinorUnits: input.proposedAmountMinorUnits,
      currency: installment.loan.currency,
    },
  });
}

export async function generatePayrollProposalsForCurrentPeriod(
  now = new Date(),
) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1,
  );
  const installments = await prisma.loanInstallment.findMany({
    where: {
      dueAt: { gte: start, lte: end },
      plan: { status: "ACTIVE" },
      loan: { status: { in: ["ACTIVE", "OVERDUE"] } },
    },
    include: {
      allocations: {
        where: { repayment: { status: "COMPLETED" } },
        select: { amountMinorUnits: true },
      },
      loan: { select: { borrowerMembershipId: true, currency: true } },
    },
  });
  let created = 0;
  let unavailable = 0;
  for (const installment of installments) {
    const paid = sumAllocations(installment.allocations);
    const outstanding = installment.amountMinorUnits - paid;
    if (outstanding <= 0n) continue;
    const mapping = await prisma.employeeDirectoryMapping.findFirst({
      where: {
        organizationId: installment.organizationId,
        matchedMembershipId: installment.loan.borrowerMembershipId,
        matchStatus: "MATCHED",
      },
      select: { id: true },
    });
    if (!mapping) {
      unavailable += 1;
      continue;
    }
    const result = await prisma.payrollDeductionProposal.createMany({
      data: [
        {
          organizationId: installment.organizationId,
          loanId: installment.loanId,
          installmentId: installment.id,
          employeeMappingId: mapping.id,
          idempotencyKey: `period:${installment.id}:${start.toISOString()}:${end.toISOString()}`,
          payrollPeriodStart: start,
          payrollPeriodEnd: end,
          scheduledAmountMinorUnits: installment.amountMinorUnits,
          outstandingAmountMinorUnits: outstanding,
          proposedAmountMinorUnits: outstanding,
          currency: installment.loan.currency,
        },
      ],
      skipDuplicates: true,
    });
    created += result.count;
  }
  return {
    eligible: installments.length,
    created,
    unavailable,
    periodStart: start,
    periodEnd: end,
  };
}

export async function authorizePayrollDeduction(
  actor: AuthenticatedActor,
  proposalId: string,
) {
  requireEmployee(actor);
  const membership = await membershipForActor(actor);
  const proposal = await prisma.payrollDeductionProposal.findFirst({
    where: {
      id: proposalId,
      organizationId: actor.organizationId,
      loan: { borrowerMembershipId: membership.id },
      status: { in: ["PROPOSED", "AWAITING_APPROVAL"] },
    },
  });
  if (!proposal)
    throw new ApplicationError(
      "PAYROLL_PROPOSAL_NOT_FOUND",
      "Proposal not found.",
      404,
    );
  return prisma.payrollDeductionProposal.update({
    where: { id: proposal.id },
    data: {
      authorizationStatus: "AUTHORIZED",
      authorizedAt: new Date(),
      status: "AWAITING_APPROVAL",
    },
  });
}

export async function reviewPayrollDeduction(
  actor: AuthenticatedActor,
  proposalId: string,
  decision: "APPROVE" | "REJECT",
  rationale: string,
) {
  requireEmployerAdmin(actor);
  const membership = await membershipForActor(actor);
  return prisma.$transaction(async (transaction) => {
    const proposal = await transaction.payrollDeductionProposal.findFirst({
      where: { id: proposalId, organizationId: actor.organizationId },
    });
    if (!proposal)
      throw new ApplicationError(
        "PAYROLL_PROPOSAL_NOT_FOUND",
        "Proposal not found.",
        404,
      );
    if (
      decision === "APPROVE" &&
      proposal.authorizationStatus !== "AUTHORIZED"
    ) {
      throw new ApplicationError(
        "EMPLOYEE_CONSENT_REQUIRED",
        "Employee authorization is required before approval.",
        409,
      );
    }
    if (!["PROPOSED", "AWAITING_APPROVAL"].includes(proposal.status)) {
      throw new ApplicationError(
        "INVALID_PAYROLL_STATUS",
        "Proposal cannot be reviewed.",
        409,
      );
    }
    const now = new Date();
    const updated = await transaction.payrollDeductionProposal.update({
      where: { id: proposal.id },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        reviewedByMembershipId: membership.id,
        reviewedAt: now,
        reviewRationale: rationale,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: actor.organizationId,
        loanId: proposal.loanId,
        actorMembershipId: membership.id,
        type: "PAYROLL_DEDUCTION_REVIEWED",
        title:
          decision === "APPROVE"
            ? "Payroll deduction approved"
            : "Payroll deduction rejected",
        metadata: { proposalId: proposal.id, rationale },
        occurredAt: now,
      },
    });
    return updated;
  });
}

export async function submitPayrollDeduction(
  actor: AuthenticatedActor,
  proposalId: string,
) {
  requireEmployerAdmin(actor);
  const membership = await membershipForActor(actor);
  const proposal = await prisma.payrollDeductionProposal.findFirst({
    where: {
      id: proposalId,
      organizationId: actor.organizationId,
      status: "APPROVED",
    },
  });
  if (!proposal)
    throw new ApplicationError(
      "PAYROLL_PROPOSAL_NOT_FOUND",
      "Approved proposal not found.",
      404,
    );
  return prisma.payrollDeductionProposal.update({
    where: { id: proposal.id },
    data: {
      status: "NOT_AVAILABLE",
      reviewedByMembershipId: membership.id,
      reviewedAt: proposal.reviewedAt ?? new Date(),
      lastSyncErrorCode: "ERP_NEXT_PAYROLL_WRITE_NOT_CONFIGURED",
    },
  });
}

export async function reconcilePayrollDeduction(
  actor: AuthenticatedActor,
  proposalId: string,
  input: { actualAmountMinorUnits: bigint; externalReference: string },
) {
  requireEmployerAdmin(actor);
  if (input.actualAmountMinorUnits <= 0n || !input.externalReference.trim()) {
    throw new ApplicationError(
      "INVALID_RECONCILIATION",
      "Invalid reconciliation result.",
      400,
    );
  }
  const membership = await membershipForActor(actor);
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`payroll:${proposalId}`}, 0))
    `;
    const proposal = await transaction.payrollDeductionProposal.findFirst({
      where: { id: proposalId, organizationId: actor.organizationId },
      include: {
        installment: {
          include: {
            allocations: {
              where: { repayment: { status: "COMPLETED" } },
              select: { amountMinorUnits: true },
            },
          },
        },
        loan: {
          include: {
            repayments: {
              where: { status: "COMPLETED" },
              select: { amountMinorUnits: true },
            },
          },
        },
        repayment: true,
      },
    });
    if (!proposal)
      throw new ApplicationError(
        "PAYROLL_PROPOSAL_NOT_FOUND",
        "Proposal not found.",
        404,
      );
    if (proposal.repayment) return proposal;
    // An Arc-backed loan is settled only by verified on-chain repayment. An
    // off-chain payroll record here would mark the loan repaid while the
    // escrow still holds it active and the lender received no USDC.
    if (proposal.loan.chainLoanId !== null) {
      throw new ApplicationError(
        "ON_CHAIN_LOAN_REQUIRES_ON_CHAIN_REPAYMENT",
        "This loan is held on Arc and can only be repaid on-chain.",
        409,
      );
    }
    if (
      !proposal.reviewedAt ||
      proposal.authorizationStatus !== "AUTHORIZED" ||
      !["APPROVED", "SUBMITTED", "FAILED", "NOT_AVAILABLE"].includes(
        proposal.status,
      )
    ) {
      throw new ApplicationError(
        "PAYROLL_RECONCILIATION_NOT_ALLOWED",
        "The deduction is not authorized and approved.",
        409,
      );
    }
    const paid = sumAllocations(proposal.installment.allocations);
    const outstanding = proposal.installment.amountMinorUnits - paid;
    if (
      input.actualAmountMinorUnits > outstanding ||
      input.actualAmountMinorUnits > proposal.proposedAmountMinorUnits
    ) {
      throw new ApplicationError(
        "PAYROLL_AMOUNT_EXCEEDS_OUTSTANDING",
        "Actual deduction exceeds the verified balance.",
        409,
      );
    }
    const now = new Date();
    const repayment = await transaction.loanRepayment.create({
      data: {
        organizationId: actor.organizationId,
        loanId: proposal.loanId,
        repaymentRequestId: proposal.id,
        amountMinorUnits: input.actualAmountMinorUnits,
        currency: proposal.currency,
        status: "COMPLETED",
        paidAt: now,
        completedAt: now,
      },
    });
    const allocations = allocateRepaymentOldestFirst({
      repaymentAmountMinorUnits: input.actualAmountMinorUnits,
      installments: [
        {
          id: proposal.installment.id,
          sequence: proposal.installment.sequence,
          amountMinorUnits: proposal.installment.amountMinorUnits,
          paidMinorUnits: paid,
        },
      ],
    });
    await transaction.repaymentAllocation.createMany({
      data: allocations.map((allocation) => ({
        organizationId: actor.organizationId,
        repaymentId: repayment.id,
        installmentId: allocation.installmentId,
        amountMinorUnits: allocation.amountMinorUnits,
      })),
    });
    const platform = await ensurePlatformFundingAccount(
      transaction,
      actor.organizationId,
    );
    const lender = await ensureUserWallet(transaction, {
      organizationId: actor.organizationId,
      membershipId: proposal.loan.lenderMembershipId,
    });
    await postLedgerTransaction(transaction, {
      organizationId: actor.organizationId,
      type: "LOAN_REPAYMENT",
      referenceType: "REPAYMENT",
      referenceId: repayment.id,
      idempotencyKey: `payroll-repayment:${proposal.id}`,
      now,
      entries: [
        {
          accountId: platform.id,
          direction: "DEBIT",
          amountMinorUnits: input.actualAmountMinorUnits,
        },
        {
          accountId: lender.id,
          direction: "CREDIT",
          amountMinorUnits: input.actualAmountMinorUnits,
        },
      ],
    });
    const previouslyRepaid = proposal.loan.repayments.reduce(
      (total, item) => total + item.amountMinorUnits,
      0n,
    );
    const total =
      proposal.loan.principalAmountMinorUnits +
      proposal.loan.feeAmountMinorUnits;
    const isFullyRepaid =
      previouslyRepaid + input.actualAmountMinorUnits === total;
    const principalReduction = calculatePrincipalReduction({
      feeAmountMinorUnits: proposal.loan.feeAmountMinorUnits,
      previouslyRepaidMinorUnits: previouslyRepaid,
      repaymentAmountMinorUnits: input.actualAmountMinorUnits,
      outstandingPrincipalMinorUnits:
        proposal.loan.outstandingPrincipalMinorUnits,
    });
    await transaction.loan.update({
      where: { id: proposal.loanId },
      data: {
        outstandingPrincipalMinorUnits: { decrement: principalReduction },
        ...(isFullyRepaid ? { status: "REPAID", closedAt: now } : {}),
      },
    });
    const status =
      input.actualAmountMinorUnits === outstanding
        ? "RECONCILED"
        : "PARTIALLY_DEDUCTED";
    const updated = await transaction.payrollDeductionProposal.update({
      where: { id: proposal.id },
      data: {
        status,
        actualDeductedMinorUnits: input.actualAmountMinorUnits,
        erpNextDocumentReference: input.externalReference.trim(),
        erpNextDocumentType: "Payroll result (externally verified)",
        repaymentId: repayment.id,
        reconciledAt: now,
        lastSyncErrorCode: null,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: actor.organizationId,
        loanId: proposal.loanId,
        repaymentId: repayment.id,
        actorMembershipId: membership.id,
        amountMinorUnits: input.actualAmountMinorUnits,
        currency: proposal.currency,
        type: "PAYROLL_DEDUCTION_RECONCILED",
        title: "Verified payroll deduction reconciled",
        metadata: {
          proposalId: proposal.id,
          externalReference: input.externalReference.trim(),
        },
        occurredAt: now,
      },
    });
    return updated;
  });
}

function recommendation(input: {
  pending: bigint;
  paid: bigint;
  payrollStatus?: string;
}) {
  if (input.pending > 0n) return "CHECK_PAYMENT_RECONCILIATION";
  if (input.payrollStatus === "APPROVED" || input.payrollStatus === "SUBMITTED")
    return "REVIEW_PAYROLL_PROCESSING";
  if (input.paid > 0n) return "REVIEW_PARTIAL_PAYMENT";
  return "CONTACT_EMPLOYEE_HUMAN_REVIEW";
}

function thresholdForDays(days: number) {
  if (days >= escalationDays()) return "ESCALATION";
  if (days >= followUpDays()) return "FOLLOW_UP";
  return days >= 1 ? "FIRST_OVERDUE" : null;
}

function money(amount: bigint, currency: string) {
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${currency} ${amount < 0n ? "-" : ""}${whole}.${fraction}`;
}

async function deliverNotification(notificationId: string) {
  const notification = await prisma.delinquencyNotification.findUnique({
    where: { id: notificationId },
    include: {
      recipientMembership: { include: { user: { select: { email: true } } } },
      case: { include: { installment: true, loan: true } },
    },
  });
  if (!notification || notification.deliveryStatus === "SENT") return;
  const item = notification.case;
  const isBorrower =
    notification.recipientMembershipId === item.loan.borrowerMembershipId;
  const reviewUrl = isBorrower
    ? `${process.env.APP_URL ?? ""}/app/loans/${item.loanId}`
    : `${process.env.APP_URL ?? ""}/employer/delinquency`;
  const text = [
    `Loan reference: ${item.loanId}`,
    `Installment due: ${item.installment.dueAt.toISOString()}`,
    `Originally due: ${money(item.amountDueMinorUnits, item.loan.currency)}`,
    `Paid: ${money(item.amountPaidMinorUnits, item.loan.currency)}`,
    `Outstanding: ${money(item.outstandingMinorUnits, item.loan.currency)}`,
    `Days overdue: ${item.daysOverdue}`,
    ...(isBorrower ? [] : [`Recommended action: ${item.recommendedAction}`]),
    reviewUrl,
  ].join("\n");
  try {
    await emailSender.send({
      to: notification.recipientMembership.user.email,
      subject: isBorrower
        ? `QastFund repayment overdue: ${notification.thresholdKey}`
        : `QastFund repayment review: ${notification.thresholdKey}`,
      text,
      html: transactionalEmailHtml({
        preheader: `Repayment review required for loan ${item.loanId}.`,
        eyebrow: isBorrower ? "Your repayment" : "Repayment operations",
        title: isBorrower ? "Repayment overdue" : "Repayment review required",
        bodyHtml: `<p style="margin:0 0 20px;color:#64748B;">${isBorrower ? "An installment has an outstanding overdue balance. Review your loan and make a payment or contact your employer if you need help." : "A repayment exception needs your attention. Review the account details and recommended next step below."}</p>
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${[
              ["Loan reference", item.loanId],
              ["Installment due", item.installment.dueAt.toISOString()],
              [
                "Originally due",
                money(item.amountDueMinorUnits, item.loan.currency),
              ],
              ["Paid", money(item.amountPaidMinorUnits, item.loan.currency)],
              [
                "Outstanding",
                money(item.outstandingMinorUnits, item.loan.currency),
              ],
              ["Days overdue", String(item.daysOverdue)],
              ...(isBorrower
                ? []
                : [["Recommended action", item.recommendedAction]]),
            ]
              .map(
                ([label, value]) =>
                  `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #E5EAF1;color:#64748B;font-size:13px;">${escapeHtml(label)}</td><td style="padding:8px 0;border-bottom:1px solid #E5EAF1;color:#172033;font-size:13px;font-weight:700;">${escapeHtml(value)}</td></tr>`,
              )
              .join("")}
          </table>`,
        action: {
          label: isBorrower ? "View loan" : "Review repayment",
          url: reviewUrl,
        },
        notice: {
          title: "Operational notice",
          bodyHtml: isBorrower
            ? '<p style="margin:0;">This notice does not change your employment status. Contact your employer to discuss an arrangement if needed.</p>'
            : '<p style="margin:0;">Handle this case according to your organization\'s repayment review policy. Do not take employment action automatically.</p>',
        },
      }),
      idempotencyKey: notification.idempotencyKey,
    });
    await prisma.delinquencyNotification.update({
      where: { id: notification.id },
      data: {
        deliveryStatus: "SENT",
        deliveryAttempts: { increment: 1 },
        sentAt: new Date(),
        lastFailureCode: null,
      },
    });
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "EMAIL_DELIVERY_FAILED";
    await prisma.delinquencyNotification.update({
      where: { id: notification.id },
      data: {
        deliveryStatus: "FAILED",
        deliveryAttempts: { increment: 1 },
        lastFailureCode: code,
      },
    });
  }
}

export async function evaluateOverdueInstallments(now = new Date()) {
  const installments = await prisma.loanInstallment.findMany({
    where: {
      plan: { status: "ACTIVE" },
      loan: { status: { in: ["ACTIVE", "OVERDUE", "REPAID"] } },
    },
    orderBy: [{ loanId: "asc" }, { sequence: "asc" }],
    include: {
      allocations: {
        where: { repayment: { status: "COMPLETED" } },
        select: { amountMinorUnits: true },
      },
      loan: {
        include: {
          repayments: {
            where: { status: "PENDING" },
            select: { amountMinorUnits: true },
          },
        },
      },
      payrollDeductions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const remainingPending = new Map<string, bigint>();
  let opened = 0;
  let resolved = 0;
  const notificationIds: string[] = [];
  for (const installment of installments) {
    let pending = remainingPending.get(installment.loanId);
    if (pending === undefined) {
      pending = installment.loan.repayments.reduce(
        (sum, item) => sum + item.amountMinorUnits,
        0n,
      );
    }
    const paid = sumAllocations(installment.allocations);
    const outstanding = installment.amountMinorUnits - paid;
    const appliedPending = pending < outstanding ? pending : outstanding;
    remainingPending.set(installment.loanId, pending - appliedPending);
    const derived = deriveInstallmentState({
      amountMinorUnits: installment.amountMinorUnits,
      paidMinorUnits: paid,
      pendingMinorUnits: appliedPending,
      dueAt: installment.dueAt,
      now,
      gracePeriodMs: gracePeriodMs(),
    });
    const existing = await prisma.delinquencyCase.findUnique({
      where: { installmentId: installment.id },
    });
    const overdue =
      derived.daysOverdue > 0 &&
      derived.outstandingMinorUnits > 0n &&
      derived.state !== "PAYMENT_PENDING";
    if (!overdue) {
      if (existing?.status === "OPEN") {
        await prisma.delinquencyCase.update({
          where: { id: existing.id },
          data: {
            status: "RESOLVED",
            state: derived.state,
            outstandingMinorUnits: derived.outstandingMinorUnits,
            amountPaidMinorUnits: paid,
            daysOverdue: 0,
            lastEvaluatedAt: now,
          },
        });
        resolved += 1;
      }
      continue;
    }
    const payrollStatus = installment.payrollDeductions[0]?.status;
    const caseRecord = await prisma.delinquencyCase.upsert({
      where: { installmentId: installment.id },
      update: {
        status: "OPEN",
        amountPaidMinorUnits: paid,
        outstandingMinorUnits: derived.outstandingMinorUnits,
        daysOverdue: derived.daysOverdue,
        state: derived.state,
        payrollStatus,
        recommendedAction: recommendation({
          pending: appliedPending,
          paid,
          payrollStatus,
        }),
        lastEvaluatedAt: now,
      },
      create: {
        organizationId: installment.organizationId,
        loanId: installment.loanId,
        installmentId: installment.id,
        amountDueMinorUnits: installment.amountMinorUnits,
        amountPaidMinorUnits: paid,
        outstandingMinorUnits: derived.outstandingMinorUnits,
        daysOverdue: derived.daysOverdue,
        state: derived.state,
        payrollStatus,
        recommendedAction: recommendation({
          pending: appliedPending,
          paid,
          payrollStatus,
        }),
        lastEvaluatedAt: now,
      },
    });
    if (!existing) opened += 1;
    const threshold = thresholdForDays(derived.daysOverdue);
    if (!threshold) continue;
    const employerRecipient = await prisma.organizationMembership.findFirst({
      where: {
        organizationId: installment.organizationId,
        role: "EMPLOYER_ADMIN",
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const recipients = [
      { id: installment.loan.borrowerMembershipId, audience: "borrower" },
      ...(employerRecipient
        ? [{ id: employerRecipient.id, audience: "employer" }]
        : []),
    ];
    for (const recipient of recipients) {
      const notification = await prisma.delinquencyNotification.upsert({
        where: {
          caseId_thresholdKey_recipientMembershipId: {
            caseId: caseRecord.id,
            thresholdKey: threshold,
            recipientMembershipId: recipient.id,
          },
        },
        update: {},
        create: {
          organizationId: installment.organizationId,
          caseId: caseRecord.id,
          recipientMembershipId: recipient.id,
          idempotencyKey: `delinquency:${caseRecord.id}:${threshold}:${recipient.audience}`,
          thresholdKey: threshold,
        },
      });
      if (notification.deliveryStatus !== "SENT")
        notificationIds.push(notification.id);
    }
  }
  for (const id of notificationIds) await deliverNotification(id);
  return {
    evaluated: installments.length,
    opened,
    resolved,
    notifications: notificationIds.length,
  };
}

export async function listDelinquencyCases(actor: AuthenticatedActor) {
  requireEmployerAdmin(actor);
  return prisma.delinquencyCase.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: [{ status: "asc" }, { daysOverdue: "desc" }],
    include: {
      installment: { select: { sequence: true, dueAt: true } },
      loan: {
        select: {
          borrowerMembership: { select: { user: { select: { name: true } } } },
          currency: true,
        },
      },
      notifications: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function actOnDelinquencyCase(
  actor: AuthenticatedActor,
  caseId: string,
  input: {
    action: "REVIEW" | "CONTACT" | "REQUEST_ARRANGEMENT" | "RETRY_NOTIFICATION";
    note?: string;
  },
) {
  requireEmployerAdmin(actor);
  const membership = await membershipForActor(actor);
  const record = await prisma.delinquencyCase.findFirst({
    where: { id: caseId, organizationId: actor.organizationId },
    include: {
      notifications: {
        where: { deliveryStatus: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!record)
    throw new ApplicationError(
      "DELINQUENCY_CASE_NOT_FOUND",
      "Case not found.",
      404,
    );
  if (input.action === "RETRY_NOTIFICATION") {
    const notification = record.notifications[0];
    if (!notification)
      throw new ApplicationError(
        "FAILED_NOTIFICATION_NOT_FOUND",
        "No failed notification is available.",
        409,
      );
    await deliverNotification(notification.id);
    return prisma.delinquencyCase.findUniqueOrThrow({
      where: { id: record.id },
    });
  }
  const now = new Date();
  const updated = await prisma.delinquencyCase.update({
    where: { id: record.id },
    data:
      input.action === "REVIEW"
        ? {
            reviewedByMembershipId: membership.id,
            reviewedAt: now,
            reviewNote: input.note,
          }
        : input.action === "REQUEST_ARRANGEMENT"
          ? {
              reviewedByMembershipId: membership.id,
              arrangementRequestedByMembershipId: membership.id,
              arrangementRequestedAt: now,
              arrangementRequestNote: input.note,
            }
          : {
              reviewedByMembershipId: membership.id,
              employeeContactedAt: now,
              contactNote: input.note,
            },
  });
  await prisma.auditEvent.create({
    data: {
      organizationId: actor.organizationId,
      loanId: record.loanId,
      actorMembershipId: membership.id,
      type: "DELINQUENCY_CASE_REVIEWED",
      title:
        input.action === "REVIEW"
          ? "Delinquency case reviewed"
          : input.action === "REQUEST_ARRANGEMENT"
            ? "Repayment arrangement requested for human review"
            : "Employee contact recorded",
      metadata: { caseId: record.id, note: input.note ?? null },
      occurredAt: now,
    },
  });
  return updated;
}
