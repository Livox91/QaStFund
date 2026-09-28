import type { Metadata } from "next";

import { EmployerSectionPlaceholder } from "@/modules/organizations/ui/employer-section-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function EmployerSettingsPage() {
  return (
    <EmployerSectionPlaceholder
      description="Review organization-level preferences and administration settings."
      title="Settings"
    />
  );
}
