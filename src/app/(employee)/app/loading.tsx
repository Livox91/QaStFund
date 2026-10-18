import { LoadingState } from "@/shared/ui/loading-state";

export default function EmployeeDashboardLoading() {
  return (
    <main className="app-page app-page-wide">
      <LoadingState className="min-h-[32rem]" label="Loading your dashboard" />
    </main>
  );
}
