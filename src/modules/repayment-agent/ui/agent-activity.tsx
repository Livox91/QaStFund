import type { SerializedAgentRun } from "@/modules/repayment-agent/index.server";
import { Badge, type BadgeTone } from "@/shared/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatUsdc } from "@/shared/money/usdc";

const EXPLORER = "https://explorer.testnet.arc.io/tx/";

const phaseTone: Record<string, BadgeTone> = {
  OBSERVE: "neutral",
  REASON: "info",
  TOOL: "neutral",
  VALIDATE: "accent",
  ACT: "warning",
  VERIFY: "success",
  ADAPT: "danger",
  EXPLAIN: "info",
};

const statusTone: Record<string, BadgeTone> = {
  COMPLETED: "success",
  WAITING: "neutral",
  AWAITING_APPROVAL: "warning",
  ESCALATED: "danger",
  STOPPED: "neutral",
  FAILED: "danger",
  RUNNING: "info",
};

const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function label(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function PolicyChecks({ data }: { data: unknown }) {
  if (!Array.isArray(data)) return null;
  return (
    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
      {(data as Array<{ code: string; passed: boolean; detail: string }>).map(
        (check) => (
          <li className="flex gap-2 text-xs leading-5" key={check.code}>
            <span
              aria-hidden="true"
              className={check.passed ? "text-emerald-600" : "text-rose-600"}
            >
              {check.passed ? "✓" : "✕"}
            </span>
            <span className="text-slate-600">
              <span className="font-medium text-slate-800">
                {label(check.code)}
              </span>{" "}
              — {check.detail}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}

function Alternatives({ data }: { data: unknown }) {
  const alternatives = (
    data as { rejectedAlternatives?: Array<{ action: string; reason: string }> }
  )?.rejectedAlternatives;
  const reasons = (data as { reasonCodes?: string[] })?.reasonCodes;
  if (!alternatives?.length) return null;
  return (
    <div className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
      {reasons?.length ? (
        <p>
          <span className="font-medium text-slate-800">Reasons:</span>{" "}
          {reasons.map(label).join(" · ")}
        </p>
      ) : null}
      {alternatives.map((alternative) => (
        <p key={alternative.action}>
          <span className="font-medium text-slate-800">
            Rejected {label(alternative.action)}:
          </span>{" "}
          {alternative.reason}
        </p>
      ))}
    </div>
  );
}

export function AgentActivity({
  runs,
}: {
  runs: ReadonlyArray<SerializedAgentRun>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent activity</CardTitle>
        <CardDescription>
          Every run records what the agent observed, the options it had, why it
          chose one, what it executed, and how it verified the result.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {runs.length === 0 ? (
          <EmptyState
            description="Runs appear here after the agent's first scheduled or manual check."
            title="No agent runs yet"
          />
        ) : (
          runs.map((run, index) => (
            <details
              className="group rounded-xl border border-slate-200 bg-white open:shadow-sm"
              key={run.id}
              open={index === 0}
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                <Badge tone={statusTone[run.status] ?? "neutral"}>
                  {label(run.status)}
                </Badge>
                <span className="text-sm font-medium text-slate-900">
                  {run.outcomeSummary ?? label(run.outcomeCode ?? "Running")}
                </span>
                <span className="ml-auto text-xs text-slate-500">
                  {dateTime.format(new Date(run.startedAt))} ·{" "}
                  {label(run.trigger)} ·{" "}
                  {run.plannerKind === "MODEL"
                    ? run.plannerModel
                    : "Rule planner"}
                </span>
              </summary>
              <ol className="space-y-3 border-t border-slate-100 p-4">
                {run.steps.map((step) => (
                  <li className="flex gap-3" key={step.sequence}>
                    <span className="w-6 shrink-0 pt-0.5 text-right text-xs text-slate-400 tabular-nums">
                      {step.sequence}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={phaseTone[step.phase] ?? "neutral"}>
                          {step.phase}
                        </Badge>
                        <span className="text-xs font-semibold text-slate-700">
                          {step.name}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 break-words text-slate-700">
                        {step.summary}
                      </p>
                      {step.name === "POLICY_CHECKS" ||
                      step.name === "PRE_EXECUTION_RECHECK" ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-medium text-slate-500">
                            Show checks
                          </summary>
                          <PolicyChecks data={step.data} />
                        </details>
                      ) : null}
                      {step.name === "DECISION_ACCEPTED" ? (
                        <Alternatives data={step.data} />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
              {run.actions.some((action) => action.transactionHash) ? (
                <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
                  {run.actions
                    .filter((action) => action.transactionHash)
                    .map((action) => (
                      <p key={action.id}>
                        {label(action.action)}{" "}
                        {action.amountBaseUnits
                          ? `${formatUsdc(BigInt(action.amountBaseUnits))} USDC`
                          : ""}{" "}
                        · {label(action.status)} ·{" "}
                        <a
                          className="text-brand font-medium underline"
                          href={`${EXPLORER}${action.transactionHash}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          View transaction
                        </a>
                      </p>
                    ))}
                </div>
              ) : null}
            </details>
          ))
        )}
      </CardContent>
    </Card>
  );
}
