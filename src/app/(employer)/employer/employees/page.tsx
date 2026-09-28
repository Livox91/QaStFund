import type { Metadata } from "next";

import { EmployerSectionPlaceholder } from "@/modules/organizations/ui/employer-section-placeholder";

export const metadata: Metadata = { title: "Employees" };

export default function EmployerEmployeesPage() {
  return (
    <EmployerSectionPlaceholder
      description="Manage employee participation and organization membership."
      title="Employees"
    />
  );
}
