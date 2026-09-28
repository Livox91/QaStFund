import { forwardRef } from "react";

import { cn } from "@/shared/utils/class-names";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(
        "h-11 w-full rounded-lg border bg-white px-3.5 text-sm text-slate-950 shadow-sm transition outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
        error
          ? "border-rose-400 focus:border-rose-500 focus:ring-3 focus:ring-rose-100"
          : "border-slate-300 focus:border-teal-600 focus:ring-3 focus:ring-teal-100",
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  children,
  className,
  error,
  hint,
  htmlFor,
  label,
  optional = false,
}: {
  children: React.ReactNode;
  className?: string;
  error?: string;
  hint?: string;
  htmlFor: string;
  label: string;
  optional?: boolean;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm font-medium text-slate-700" htmlFor={htmlFor}>
          {label}
        </label>
        {optional ? (
          <span className="text-xs text-slate-400">Optional</span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p className="text-sm text-rose-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
