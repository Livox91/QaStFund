import type { Metadata } from "next";

import { EmployerSectionPlaceholder } from "@/modules/organizations/ui/employer-section-placeholder";

export const metadata: Metadata = { title: "Policies" };

export default function EmployerPoliciesPage() {
  return (
    <EmployerSectionPlaceholder
      description="Configure the rules that govern your organization's lending program."
      title="Policies"
    />
  );
}
