import { LoadingState } from "@/shared/ui/loading-state";

export default function EmployeeDashboardLoading() {
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <LoadingState className="min-h-[32rem]" label="Loading your dashboard" />
    </main>
  );
}
