import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  EmployerActionIdempotencyConflictError,
  EmployerActionNotAllowedError,
  EmployerActionTargetNotFoundError,
} from "@/modules/employer-actions/application/errors";
import type { EmployerActionRepository } from "@/modules/employer-actions/application/ports/employer-action-repository";
import type {
  EmployerActionAdapter,
  EmployerActionAttempt,
  EmployerActionProvider,
  EmployerActionType,
} from "@/modules/employer-actions/domain/employer-action";
import type { Clock } from "@/shared/time/clock";

export type ExecuteEmployerActionCommand = Readonly<{
  loanId: string;
  action: EmployerActionType;
  idempotencyKey: string;
}>;

function isAllowed(
  action: EmployerActionType,
  context: NonNullable<
    Awaited<ReturnType<EmployerActionRepository["findContext"]>>
  >,
): boolean {
  if (
    context.financialStatus !== "ACTIVE" &&
    context.financialStatus !== "OVERDUE"
  ) {
    return false;
  }
  if (action === "mark_reviewed") return true;
  if (!context.reviewedAt) return false;
  if (action === "request_employee_contact") {
    return context.classification !== "healthy";
  }
  return (
    context.classification === "overdue" ||
    context.classification === "default_candidate"
  );
}

function isSameRequest(
  attempt: EmployerActionAttempt,
  command: ExecuteEmployerActionCommand,
  requestedByUserId: string,
): boolean {
  return (
    attempt.loanId === command.loanId &&
    attempt.action === command.action &&
    attempt.requestedByUserId === requestedByUserId
  );
}

export async function executeEmployerAction(
  actor: AuthenticatedActor | null,
  command: ExecuteEmployerActionCommand,
  adapter: EmployerActionAdapter,
  provider: EmployerActionProvider,
  repository: EmployerActionRepository,
  clock: Clock,
): Promise<EmployerActionAttempt> {
  const employer = requireEmployerAdmin(actor);
  const existing = await repository.findByIdempotencyKey({
    organizationId: employer.organizationId,
    idempotencyKey: command.idempotencyKey,
    requestedByUserId: employer.userId,
  });
  if (existing) {
    if (!isSameRequest(existing, command, employer.userId)) {
      throw new EmployerActionIdempotencyConflictError();
    }
    return existing;
  }

  const context = await repository.findContext({
    organizationId: employer.organizationId,
    loanId: command.loanId,
    requestedByUserId: employer.userId,
  });
  if (!context) throw new EmployerActionTargetNotFoundError();
  if (!isAllowed(command.action, context)) {
    throw new EmployerActionNotAllowedError();
  }

  const claimed = await repository.claimAttempt({
    organizationId: employer.organizationId,
    loanId: command.loanId,
    evaluationId: context.evaluationId,
    requestedByUserId: employer.userId,
    action: command.action,
    provider,
    idempotencyKey: command.idempotencyKey,
    requestedAt: clock.now(),
  });
  if (!claimed) throw new EmployerActionTargetNotFoundError();
  if (claimed.kind === "EXISTING") {
    if (!isSameRequest(claimed.attempt, command, employer.userId)) {
      throw new EmployerActionIdempotencyConflictError();
    }
    return claimed.attempt;
  }

  let result;
  try {
    result = await adapter.execute({
      loanId: command.loanId,
      organizationId: employer.organizationId,
      requestedBy: employer.userId,
      action: command.action,
      idempotencyKey: command.idempotencyKey,
    });
  } catch {
    result = {
      status: "failed" as const,
      actionId: `failed_${claimed.attempt.id}`,
      messageCode: "ADAPTER_EXECUTION_FAILED",
    };
  }

  return repository.completeAttempt({
    organizationId: employer.organizationId,
    attemptId: claimed.attempt.id,
    result,
    completedAt: clock.now(),
  });
}
