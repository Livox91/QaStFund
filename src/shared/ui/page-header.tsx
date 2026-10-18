import { cn } from "@/shared/utils/class-names";

export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  title,
}: {
  actions?: React.ReactNode;
  className?: string;
  description?: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-5 md:flex-row md:items-end",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-brand text-sm font-semibold">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance text-slate-950 sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="w-full shrink-0 md:w-auto">{actions}</div>
      ) : null}
    </div>
  );
}
