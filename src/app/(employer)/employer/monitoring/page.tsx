import type { Metadata } from "next";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { getLoanMonitoringForActor } from "@/modules/loan-decisions/index.server";
import { LoanMonitoring } from "@/modules/loan-decisions/ui/loan-monitoring";

export const metadata: Metadata = { title: "Loan monitoring" };
export const dynamic = "force-dynamic";

export default async function LoanMonitoringPage() {
  const actor = await requireEmployerAdminPage();
  await enforceUserRateLimit(actor, "loan.monitoring.read", "administrative");
  const loans = await getLoanMonitoringForActor(actor);
  return (
    <LoanMonitoring loans={loans} organizationName={actor.organizationName} />
  );
}
