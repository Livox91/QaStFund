import "server-only";

import { validateEnvironment } from "@/infrastructure/config/environment";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  executeEmployerAction,
  type ExecuteEmployerActionCommand,
} from "@/modules/employer-actions/application/execute-employer-action";
import { listEmployerActions } from "@/modules/employer-actions/application/list-employer-actions";
import type { EmployerActionProvider } from "@/modules/employer-actions/domain/employer-action";
import { createEmployerActionAdapter } from "@/modules/employer-actions/infrastructure/employer-action-provider";
import { prismaEmployerActionRepository } from "@/modules/employer-actions/infrastructure/prisma-employer-action-repository";
import { systemClock } from "@/shared/time/clock";

function configuredProvider(): EmployerActionProvider {
  return validateEnvironment().EMPLOYER_ACTION_PROVIDER;
}

export function executeEmployerActionForActor(
  actor: AuthenticatedActor | null,
  command: ExecuteEmployerActionCommand,
) {
  const provider = configuredProvider();
  return executeEmployerAction(
    actor,
    command,
    createEmployerActionAdapter(provider),
    provider,
    prismaEmployerActionRepository,
    systemClock,
  );
}

export function listEmployerActionsForActor(
  actor: AuthenticatedActor | null,
  loanId: string,
) {
  return listEmployerActions(actor, loanId, prismaEmployerActionRepository);
}
