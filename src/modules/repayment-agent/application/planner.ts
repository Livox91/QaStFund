import type { PolicyCheck } from "@/modules/repayment-agent/domain/agent-run";
import type { RepaymentToolbox } from "@/modules/repayment-agent/tools/repayment-tools";

export type PlannerHistoryEntry = Readonly<{
  iteration: number;
  action: string;
  loanRef: string | null;
  amountBaseUnits: string | null;
  outcome: string;
  note: string;
}>;

export type PlannerRequest = Readonly<{
  toolbox: RepaymentToolbox;
  /** Earlier actions in this run and what happened, for replanning. */
  history: ReadonlyArray<PlannerHistoryEntry>;
  /** Failed checks from a rejected previous plan in this iteration. */
  rejectedChecks: ReadonlyArray<PolicyCheck> | null;
}>;

export type PlannerResult = Readonly<{
  /** Raw, untrusted output. Always passed through `validateAgentDecision`. */
  decision: unknown;
  kind: "MODEL" | "RULES";
  model: string | null;
  /** Set when the primary planner failed and the fallback answered. */
  fallbackCode?: string;
}>;

export interface RepaymentPlanner {
  readonly kind: "MODEL" | "RULES";
  readonly model: string | null;
  plan(request: PlannerRequest): Promise<PlannerResult>;
}

export class PlannerUnavailableError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PlannerUnavailableError";
  }
}

/** Uses the primary planner and falls back to the deterministic one on failure. */
export class FallbackPlanner implements RepaymentPlanner {
  readonly kind;
  readonly model;

  constructor(
    private readonly primary: RepaymentPlanner,
    private readonly fallback: RepaymentPlanner,
  ) {
    this.kind = primary.kind;
    this.model = primary.model;
  }

  async plan(request: PlannerRequest): Promise<PlannerResult> {
    try {
      return await this.primary.plan(request);
    } catch (error) {
      const result = await this.fallback.plan(request);
      return {
        ...result,
        fallbackCode:
          error instanceof PlannerUnavailableError
            ? error.code
            : "PLANNER_FAILED",
      };
    }
  }
}
