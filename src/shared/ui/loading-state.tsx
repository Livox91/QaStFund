import { cn } from "@/shared/utils/class-names";

export function Spinner({
  className,
  label = "Loading",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="status"
    >
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-slate-300 border-r-teal-600"
      />
      <span className="text-sm font-medium text-slate-600">{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block animate-pulse rounded-lg bg-slate-200",
        className ?? "h-4 w-full",
      )}
    />
  );
}

export function LoadingState({
  className,
  label = "Loading content",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white",
        className,
      )}
    >
      <Spinner label={label} />
    </div>
  );
}
