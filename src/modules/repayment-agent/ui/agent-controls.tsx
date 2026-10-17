"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Address, Hex } from "viem";

import { useCircleWallet } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import { formatUsdc } from "@/shared/money/usdc";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Field, Input } from "@/shared/ui/input";

type Call = { to: Address; data: Hex };

export type AgentControlsProps = Readonly<{
  enabled: boolean;
  configurationIssue: string | null;
  agentAddress: string | null;
  plannerLabel: string;
  mandate: {
    maxPerRepaymentBaseUnits: string;
    maxPerPeriodBaseUnits: string;
    minimumReserveBaseUnits: string;
    earliestBeforeDueSeconds: number;
    expiresAt: string;
    chainNonce: string | null;
  } | null;
  onChainActive: boolean;
  approvals: ReadonlyArray<{
    id: string;
    amountBaseUnits: string;
    expiresAt: string | null;
    explanation: string;
  }>;
}>;

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: { message?: string } }) | null;
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Request failed (${response.status}).`,
    );
  }
  return payload as T;
}

function usdc(baseUnits: string) {
  return `${formatUsdc(BigInt(baseUnits))} USDC`;
}

function Message({
  tone,
  text,
}: {
  tone: "error" | "info" | "success";
  text: string;
}) {
  const styles = {
    error: "border-rose-200 bg-rose-50 text-rose-700",
    info: "border-blue-200 bg-blue-50 text-blue-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  return (
    <p
      aria-live="polite"
      className={`rounded-xl border px-4 py-3 text-sm ${styles[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {text}
    </p>
  );
}

export function AgentControls(props: AgentControlsProps) {
  const wallet = useCircleWallet();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "error" | "info" | "success";
    text: string;
  } | null>(null);
  const [form, setForm] = useState({
    maxPerRepaymentUsdc: "25",
    maxPerPeriodUsdc: "100",
    minimumReserveUsdc: "40",
    earliestBeforeDueDays: "7",
    expiresInDays: "90",
  });

  async function withPasskey(label: string, run: () => Promise<string>) {
    if (!wallet.isConnected) {
      setMessage({ tone: "error", text: "Reconnect your wallet first." });
      return;
    }
    setBusy(label);
    setMessage({ tone: "info", text: "Waiting for your passkey…" });
    try {
      const done = await run();
      setMessage({ tone: "success", text: done });
      await wallet.refreshWallet();
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "The operation did not complete.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function sendCalls(calls: Call[]) {
    try {
      return await wallet.sendUserOperation(calls);
    } catch {
      throw new Error(
        "The passkey operation was cancelled or failed. Nothing changed.",
      );
    }
  }

  const grantMandate = () =>
    withPasskey("grant", async () => {
      const prepared = await post<{ mandateId: string; calls: Call[] }>(
        "/api/repayment-agent/mandate",
        { requestId: crypto.randomUUID(), ...form },
      );
      const transactionHash = await sendCalls(prepared.calls);
      setMessage({ tone: "info", text: "Verifying the mandate on Arc…" });
      await post(`/api/repayment-agent/mandate/${prepared.mandateId}/confirm`, {
        transactionHash,
      });
      return "Mandate active. The agent can now repay within these limits.";
    });

  const revokeMandate = () =>
    withPasskey("revoke", async () => {
      const prepared = await post<{ calls: Call[] }>(
        "/api/repayment-agent/mandate/revoke",
      );
      const transactionHash = await sendCalls(prepared.calls);
      await post("/api/repayment-agent/mandate/revoke/confirm", {
        transactionHash,
      });
      return "Mandate revoked and escrow allowance cleared. The agent can no longer pay.";
    });

  const approve = (id: string) =>
    withPasskey(`approve-${id}`, async () => {
      const prepared = await post<{ calls: Call[] }>(
        `/api/repayment-agent/approvals/${id}`,
      );
      const transactionHash = await sendCalls(prepared.calls);
      setMessage({ tone: "info", text: "Verifying the repayment on Arc…" });
      await post(`/api/repayment-agent/approvals/${id}/confirm`, {
        transactionHash,
      });
      return "Repayment verified. The agent will replan with your new balance.";
    });

  async function runNow() {
    setBusy("run");
    setMessage({
      tone: "info",
      text: "The agent is observing, planning and verifying…",
    });
    try {
      const result = await post<{ run: { status: string; summary: string } }>(
        "/api/repayment-agent/runs",
      );
      setMessage({ tone: "success", text: result.run.summary });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "The agent run failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (!props.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Repayment agent unavailable</CardTitle>
          <CardDescription>
            {props.configurationIssue ??
              "The agent needs the mandate-capable escrow and an agent key."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const field = (
    key: keyof typeof form,
    label: string,
    hint: string,
    inputMode: "decimal" | "numeric" = "decimal",
  ) => (
    <Field hint={hint} htmlFor={key} label={label}>
      <Input
        id={key}
        inputMode={inputMode}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        value={form[key]}
      />
    </Field>
  );

  return (
    <div className="space-y-6">
      {message ? <Message text={message.text} tone={message.tone} /> : null}

      {props.approvals.map((approval) => (
        <Card className="border-amber-300" key={approval.id}>
          <CardHeader>
            <CardTitle>
              Approval requested: {usdc(approval.amountBaseUnits)}
            </CardTitle>
            <CardDescription>{approval.explanation}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy !== null}
              isLoading={busy === `approve-${approval.id}`}
              onClick={() => void approve(approval.id)}
              type="button"
            >
              Approve with passkey
            </Button>
            {approval.expiresAt ? (
              <span className="text-xs text-slate-500">
                Expires {new Date(approval.expiresAt).toLocaleString()}. Ignore
                it to let it lapse.
              </span>
            ) : null}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Your repayment mandate</CardTitle>
          <CardDescription>
            The agent ({props.plannerLabel}) can repay only your QastFund loans,
            only to your lender, and only within these limits. The escrow
            contract enforces every limit; the agent never holds your passkey.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {props.mandate && props.onChainActive ? (
            <dl className="grid gap-4 sm:grid-cols-3">
              {[
                ["Per repayment", usdc(props.mandate.maxPerRepaymentBaseUnits)],
                ["Per 30 days", usdc(props.mandate.maxPerPeriodBaseUnits)],
                [
                  "Minimum reserve",
                  usdc(props.mandate.minimumReserveBaseUnits),
                ],
                [
                  "Earliest",
                  `${props.mandate.earliestBeforeDueSeconds / 86_400} days before due`,
                ],
                [
                  "Expires",
                  new Date(props.mandate.expiresAt).toLocaleDateString(),
                ],
                ["On-chain version", props.mandate.chainNonce ?? "—"],
              ].map(([term, value]) => (
                <div key={term}>
                  <dt className="text-xs text-slate-500">{term}</dt>
                  <dd className="mt-1 font-semibold text-slate-950">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-600">
              No active mandate. Without one the agent only watches and notifies
              you.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {field(
              "maxPerRepaymentUsdc",
              "Max per repayment",
              "USDC per transaction",
            )}
            {field(
              "maxPerPeriodUsdc",
              "Max per 30 days",
              "Also the escrow allowance",
            )}
            {field(
              "minimumReserveUsdc",
              "Keep at least",
              "USDC left in your wallet",
            )}
            {field(
              "earliestBeforeDueDays",
              "Act from",
              "Days before due",
              "numeric",
            )}
            {field("expiresInDays", "Valid for", "Days", "numeric")}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy !== null}
              isLoading={busy === "grant"}
              onClick={() => void grantMandate()}
              type="button"
            >
              {props.mandate ? "Replace mandate" : "Grant mandate"}
            </Button>
            {props.mandate && props.onChainActive ? (
              <Button
                disabled={busy !== null}
                isLoading={busy === "revoke"}
                onClick={() => void revokeMandate()}
                type="button"
                variant="danger"
              >
                Revoke
              </Button>
            ) : null}
            <Button
              disabled={busy !== null}
              isLoading={busy === "run"}
              onClick={() => void runNow()}
              type="button"
              variant="outline"
            >
              Run agent now
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Agent address:{" "}
            <span className="font-mono">{props.agentAddress}</span>. Replacing
            the mandate changes its on-chain version, which invalidates any plan
            made under the old limits.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
