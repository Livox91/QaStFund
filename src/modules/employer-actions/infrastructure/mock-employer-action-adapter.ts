import { createHash } from "node:crypto";

import type {
  EmployerActionAdapter,
  EmployerActionInput,
  EmployerActionResult,
  EmployerActionStatus,
} from "@/modules/employer-actions/domain/employer-action";
import { isEmployerActionType } from "@/modules/employer-actions/domain/employer-action";

type MockTerminalStatus = Exclude<EmployerActionStatus, "pending">;

function actionId(input: EmployerActionInput): string {
  const digest = createHash("sha256")
    .update(
      [
        input.organizationId,
        input.loanId,
        input.requestedBy,
        input.action,
        input.idempotencyKey,
      ].join(":"),
    )
    .digest("hex");
  return `mock_${digest.slice(0, 24)}`;
}

export class MockEmployerActionAdapter implements EmployerActionAdapter {
  constructor(
    private readonly forcedStatusByIdempotencyKey: Readonly<
      Record<string, MockTerminalStatus>
    > = {},
  ) {}

  async execute(input: EmployerActionInput): Promise<EmployerActionResult> {
    const id = actionId(input);
    if (!isEmployerActionType(input.action as string)) {
      return {
        status: "rejected",
        actionId: id,
        messageCode: "UNSUPPORTED_ACTION",
      };
    }

    const forcedStatus =
      this.forcedStatusByIdempotencyKey[input.idempotencyKey];
    if (forcedStatus === "failed") {
      return {
        status: "failed",
        actionId: id,
        messageCode: "SIMULATED_ACTION_FAILED",
      };
    }
    if (forcedStatus === "rejected") {
      return {
        status: "rejected",
        actionId: id,
        messageCode: "SIMULATED_ACTION_REJECTED",
      };
    }

    const messageCodeByAction = {
      mark_reviewed: "SIMULATED_REVIEW_RECORDED",
      request_employee_contact: "SIMULATED_EMPLOYEE_CONTACT_REQUESTED",
      request_hr_follow_up: "SIMULATED_HR_FOLLOW_UP_REQUESTED",
    } as const;
    return {
      status: "completed",
      actionId: id,
      messageCode: messageCodeByAction[input.action],
    };
  }
}
