import type { Metadata } from "next";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { getRepaymentAgentOverview } from "@/modules/repayment-agent/index.server";
import { AgentActivity } from "@/modules/repayment-agent/ui/agent-activity";
import { AgentControls } from "@/modules/repayment-agent/ui/agent-controls";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Repayment agent" };
export const dynamic = "force-dynamic";

export default async function RepaymentAgentPage() {
  const actor = await requireEmployeePage();
  await enforceUserRateLimit(actor, "repayment-agent.page", "expensive");
  const overview = await getRepaymentAgentOverview(actor);
  const mandateOnChain = overview.onChain?.mandate as
    { active?: boolean } | null | undefined;

  return (
    <div className="space-y-8">
      <PageHeader
        description="An agent that decides when and how much to repay, pays inside the limits you sign, verifies every payment on Arc, and explains each decision."
        eyebrow="Repayments · Arc Testnet"
        title="Repayment agent"
      />
      <AgentControls
        agentAddress={overview.agentAddress}
        approvals={overview.approvals}
        configurationIssue={overview.configurationIssue}
        enabled={overview.enabled}
        mandate={overview.mandate}
        onChainActive={mandateOnChain?.active === true}
        plannerLabel={
          overview.planner?.kind === "MODEL"
            ? `${overview.planner.model}, with rule fallback`
            : "deterministic rules"
        }
      />
      <AgentActivity runs={overview.runs} />
    </div>
  );
}
