"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function PayrollActions(
  props: Readonly<{ id: string; status: string; authorized: boolean }>,
) {
  const router = useRouter();
  const [rationale, setRationale] = useState("");
  const [actualAmount, setActualAmount] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/employer/payroll-deductions/${props.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(result.error?.message ?? "Action failed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-72 space-y-2">
      {["PROPOSED", "AWAITING_APPROVAL"].includes(props.status) ? (
        <>
          <Input
            aria-label="Review rationale"
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Review rationale"
            value={rationale}
          />
          <div className="flex gap-2">
            <Button
              disabled={busy || !props.authorized || !rationale.trim()}
              onClick={() => void act({ action: "APPROVE", rationale })}
              size="sm"
            >
              Approve
            </Button>
            <Button
              disabled={busy || !rationale.trim()}
              onClick={() => void act({ action: "REJECT", rationale })}
              size="sm"
              variant="outline"
            >
              Reject
            </Button>
          </div>
        </>
      ) : null}
      {props.status === "APPROVED" ? (
        <Button
          disabled={busy}
          onClick={() => void act({ action: "SUBMIT" })}
          size="sm"
        >
          Submit to ERPNext
        </Button>
      ) : null}
      {["APPROVED", "SUBMITTED", "FAILED", "NOT_AVAILABLE"].includes(
        props.status,
      ) ? (
        <>
          <Input
            aria-label="Actual deducted amount"
            inputMode="decimal"
            onChange={(event) => setActualAmount(event.target.value)}
            placeholder="Actual amount"
            value={actualAmount}
          />
          <Input
            aria-label="External payroll reference"
            onChange={(event) => setExternalReference(event.target.value)}
            placeholder="Verified payroll reference"
            value={externalReference}
          />
          <Button
            disabled={busy || !actualAmount || !externalReference.trim()}
            onClick={() =>
              void act({ action: "RECONCILE", actualAmount, externalReference })
            }
            size="sm"
            variant="outline"
          >
            Reconcile verified result
          </Button>
        </>
      ) : null}
      {message ? <p className="text-xs text-red-700">{message}</p> : null}
    </div>
  );
}
