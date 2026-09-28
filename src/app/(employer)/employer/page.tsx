import type { Metadata } from "next";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployerOverviewForActor } from "@/modules/organizations/index.server";
import { EmployerOverviewDashboard } from "@/modules/organizations/ui/employer-overview-dashboard";

export const metadata: Metadata = {
  title: "Employer Overview",
};

export default async function EmployerOverviewPage() {
  const actor = await requireEmployerAdminPage();
  const overview = await getEmployerOverviewForActor(actor);

  return (
    <EmployerOverviewDashboard
      organizationName={actor.organizationName}
      overview={overview}
    />
  );
}
