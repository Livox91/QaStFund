"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/shared/ui/button";

export function EmployeePayrollAuthorization(
  props: Readonly<{ proposalId: string }>,
) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function authorize() {
    setBusy(true);
    setMessage(null);
    const response = await fetch(
      `/api/payroll-deductions/${props.proposalId}/authorize`,
      { method: "POST" },
    );
    setBusy(false);
    if (!response.ok) {
      setMessage("Authorization could not be recorded.");
      return;
    }
    router.refresh();
  }
  return (
    <div className="space-y-1">
      <Button
        disabled={busy}
        onClick={() => void authorize()}
        size="sm"
        variant="outline"
      >
        Authorize payroll proposal
      </Button>
      {message ? <p className="text-xs text-red-700">{message}</p> : null}
    </div>
  );
}
