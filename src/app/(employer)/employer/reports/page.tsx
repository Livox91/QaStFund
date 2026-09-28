import type { Metadata } from "next";

import { EmployerSectionPlaceholder } from "@/modules/organizations/ui/employer-section-placeholder";

export const metadata: Metadata = { title: "Reports" };

export default function EmployerReportsPage() {
  return (
    <EmployerSectionPlaceholder
      description="Understand participation, lending activity, and repayment trends."
      title="Reports"
    />
  );
}
