"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/shared/ui/button";
import { Field } from "@/shared/ui/input";

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return (
    body?.error?.message ?? `Request failed with status ${response.status}`
  );
}

export function OriginationDecisionReviewForm({
  decisionId,
}: {
  decisionId: string;
}) {
  const router = useRouter();
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState<"APPROVED" | "REJECTED" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function submit(outcome: "APPROVED" | "REJECTED") {
    const normalizedRationale = rationale.trim();
    if (normalizedRationale.length < 20) {
      setError(
        "Enter at least 20 characters explaining the evidence reviewed.",
      );
      return;
    }
    setSubmitting(outcome);
    setError(null);
    try {
      const response = await fetch(
        `/api/employer/loan-decisions/${decisionId}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome, rationale: normalizedRationale }),
        },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The review could not be recorded. Try again.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-100 pt-6">
      <Field
        error={error ?? undefined}
        hint="Record the trusted evidence and reasoning used. This review is permanent and audited."
        htmlFor="decision-rationale"
        label="Review rationale"
      >
        <textarea
          id="decision-rationale"
          className="focus:border-accent focus:ring-brand-muted min-h-28 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:ring-3"
          maxLength={1_000}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Describe the income, employment, or other supporting evidence reviewed…"
          value={rationale}
        />
      </Field>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          disabled={submitting !== null}
          isLoading={submitting === "APPROVED"}
          onClick={() => void submit("APPROVED")}
          type="button"
          variant="secondary"
        >
          Approve request
        </Button>
        <Button
          disabled={submitting !== null}
          isLoading={submitting === "REJECTED"}
          onClick={() => void submit("REJECTED")}
          type="button"
          variant="danger"
        >
          Reject request
        </Button>
      </div>
    </div>
  );
}
