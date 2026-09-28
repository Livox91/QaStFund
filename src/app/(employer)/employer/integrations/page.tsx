import type { Metadata } from "next";

import { EmployerSectionPlaceholder } from "@/modules/organizations/ui/employer-section-placeholder";

export const metadata: Metadata = { title: "Integrations" };

export default function EmployerIntegrationsPage() {
  return (
    <EmployerSectionPlaceholder
      description="View future payroll, ERP, and settlement connections."
      title="Integrations"
    />
  );
}
