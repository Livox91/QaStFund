import { cn } from "@/shared/utils/class-names";

export function ErrorState({
  action,
  className,
  description = "We could not load this content. Please try again.",
  title = "Something went wrong",
}: {
  action?: React.ReactNode;
  className?: string;
  description?: string;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-rose-200 bg-rose-50/60 px-6 py-8 text-center",
        className,
      )}
      role="alert"
    >
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-rose-100 text-lg font-semibold text-rose-700">
        <span aria-hidden="true">!</span>
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-950">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-600">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
