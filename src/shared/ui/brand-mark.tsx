import Link from "next/link";

import { cn } from "@/shared/utils/class-names";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-950 shadow-sm",
        className,
      )}
    >
      <span className="absolute -top-2 -right-2 size-6 rounded-full bg-teal-400" />
      <span className="relative text-sm font-bold tracking-tight text-white">
        EL
      </span>
    </span>
  );
}

export function ProductBrand({
  className,
  href = "/",
  subtitle,
}: {
  className?: string;
  href?: string;
  subtitle?: string;
}) {
  return (
    <Link
      className={cn("flex min-w-0 items-center gap-3", className)}
      href={href}
    >
      <BrandMark />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold tracking-tight text-slate-950">
          Employee Lending
        </span>
        {subtitle ? (
          <span className="mt-0.5 block text-xs text-slate-500">
            {subtitle}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
