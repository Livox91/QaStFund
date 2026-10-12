import Link from "next/link";

import { cn } from "@/shared/utils/class-names";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "size-9 shrink-0 overflow-visible drop-shadow-sm",
        className,
      )}
      fill="none"
      viewBox="0 0 40 40"
    >
      <rect width="40" height="40" rx="12" fill="#0D302B" />
      <circle cx="19" cy="18" r="8.5" stroke="#F5F5EF" strokeWidth="4" />
      <path
        d="m24.8 24.3 7 7"
        stroke="#10B981"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <circle cx="19" cy="18" r="2.25" fill="#10B981" />
    </svg>
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
          QastFund
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
