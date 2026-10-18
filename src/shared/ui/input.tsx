import { forwardRef } from "react";

import { cn } from "@/shared/utils/class-names";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
};

const controlStyles =
  "bg-surface h-11 w-full rounded-lg border border-slate-300 px-3.5 text-sm text-slate-950 shadow-sm transition outline-none focus:border-accent focus:ring-3 focus:ring-brand-muted disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(
        controlStyles,
        "placeholder:text-slate-400",
        error
          ? "border-rose-400 focus:border-rose-500 focus:ring-3 focus:ring-rose-100"
          : "focus:border-accent focus:ring-brand-muted border-slate-300 focus:ring-3",
        className,
      )}
      {...props}
    />
  );
});

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  error?: boolean;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, error = false, ...props }, ref) {
    return (
      <select
        ref={ref}
        aria-invalid={error || undefined}
        className={cn(
          controlStyles,
          "cursor-pointer appearance-none bg-[linear-gradient(45deg,transparent_50%,#64748b_50%),linear-gradient(135deg,#64748b_50%,transparent_50%)] bg-[size:5px_5px,5px_5px] bg-[position:calc(100%-17px)_50%,calc(100%-12px)_50%] bg-no-repeat pr-10",
          error && "border-rose-400 focus:border-rose-500 focus:ring-rose-100",
          className,
        )}
        {...props}
      />
    );
  },
);

export type TextareaProps =
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    error?: boolean;
  };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, error = false, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={error || undefined}
        className={cn(
          controlStyles,
          "h-auto min-h-28 resize-y py-3 placeholder:text-slate-400",
          error && "border-rose-400 focus:border-rose-500 focus:ring-rose-100",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Checkbox({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "text-brand focus-visible:outline-accent size-4 shrink-0 cursor-pointer rounded border-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      type="checkbox"
      {...props}
    />
  );
}

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
