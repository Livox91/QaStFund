import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";

export function EmployerSectionPlaceholder({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <main className="app-page">
      <PageHeader
        description={description}
        eyebrow="Employer portal"
        title={title}
      />
      <EmptyState
        className="mt-8"
        description="This navigation area is reserved for a future focused increment. No actions are available yet."
        title={`${title} workspace is ready`}
      />
    </main>
  );
}
