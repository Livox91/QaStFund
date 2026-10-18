import { Skeleton } from "@/shared/ui/loading-state";

export default function EmployerLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading employer portal"
      className="app-page app-page-wide"
    >
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-9 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="mt-8 grid gap-6 xl:grid-cols-[1.65fr_0.75fr]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </main>
  );
}
