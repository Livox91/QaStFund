import { cn } from "@/shared/utils/class-names";

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
}: {
  action?: React.ReactNode;
  className?: string;
  description: string;
  icon?: React.ReactNode;
  title: string;
}) {
  return (
    <div
      className={cn(
        "bg-surface flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center sm:min-h-64 sm:px-6 sm:py-12",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        {icon ?? <span aria-hidden="true">—</span>}
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
