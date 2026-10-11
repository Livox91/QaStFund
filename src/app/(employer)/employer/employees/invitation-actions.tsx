"use client";

import { useActionState } from "react";

import {
  resendEmployeeInvitationAction,
  revokeEmployeeInvitationAction,
  type InvitationActionState,
} from "@/app/(employer)/employer/employees/actions";
import { Button } from "@/shared/ui/button";

const initialState: InvitationActionState = { status: "idle", message: "" };

export function InvitationActions({
  canRevoke,
  employeeId,
}: {
  canRevoke: boolean;
  employeeId: string;
}) {
  const [resendState, resendAction, resendPending] = useActionState(
    resendEmployeeInvitationAction,
    initialState,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeEmployeeInvitationAction,
    initialState,
  );
  const states = [resendState, revokeState].filter(
    (state) => state.status !== "idle",
  );

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <form action={resendAction}>
          <input name="employeeId" type="hidden" value={employeeId} />
          <Button
            disabled={revokePending}
            isLoading={resendPending}
            size="sm"
            type="submit"
          >
            Resend invitation
          </Button>
        </form>
        {canRevoke ? (
          <form action={revokeAction}>
            <input name="employeeId" type="hidden" value={employeeId} />
            <Button
              disabled={resendPending}
              isLoading={revokePending}
              size="sm"
              type="submit"
              variant="outline"
            >
              Revoke invitation
            </Button>
          </form>
        ) : null}
      </div>
      {states.map((state, index) => (
        <p
          className={`mt-2 text-xs ${state.status === "error" ? "text-rose-700" : "text-teal-700"}`}
          key={`${state.status}-${index}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ))}
    </div>
  );
}
