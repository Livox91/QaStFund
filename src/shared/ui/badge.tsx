import { cn } from "@/shared/utils/class-names";

export type BadgeTone =
  "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const toneStyles: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-600/10",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  danger: "bg-rose-50 text-rose-700 ring-rose-600/20",
  info: "bg-sky-50 text-sky-700 ring-sky-600/20",
  accent: "bg-teal-50 text-teal-700 ring-teal-600/20",
};

export function Badge({
  children,
  className,
  tone = "neutral",
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        toneStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
