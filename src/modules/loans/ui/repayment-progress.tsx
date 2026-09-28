import { cn } from "@/shared/utils/class-names";

export function RepaymentProgress({
  basisPoints,
  className,
  showLabel = true,
}: {
  basisPoints: number;
  className?: string;
  showLabel?: boolean;
}) {
  const clampedBasisPoints = Math.min(10_000, Math.max(0, basisPoints));
  const percentage = Math.round(clampedBasisPoints / 100);

  return (
    <div className={cn("min-w-28", className)}>
      {showLabel ? (
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-500">Repaid</span>
          <span className="font-semibold text-slate-700 tabular-nums">
            {percentage}%
          </span>
        </div>
      ) : null}
      <div
        aria-label={`${percentage}% repaid`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percentage}
        className="h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-teal-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
