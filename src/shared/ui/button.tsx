import { forwardRef } from "react";

import { cn } from "@/shared/utils/class-names";

const variantStyles = {
  primary:
    "bg-brand !text-white shadow-sm hover:bg-brand-hover focus-visible:outline-brand",
  secondary:
    "border border-brand-border bg-brand-soft !text-brand shadow-sm hover:bg-brand-muted focus-visible:outline-brand",
  outline:
    "border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-slate-600",
  ghost:
    "text-slate-600 hover:bg-brand-soft hover:text-brand focus-visible:outline-brand",
  danger:
    "bg-rose-600 !text-white shadow-sm hover:bg-rose-700 focus-visible:outline-rose-600",
  inverse:
    "bg-white !text-slate-950 shadow-sm hover:bg-brand-soft focus-visible:outline-white",
  inverseOutline:
    "border border-white/30 bg-transparent !text-white shadow-sm hover:bg-white/10 focus-visible:outline-white",
} as const;

const sizeStyles = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-lg px-4 text-sm",
  lg: "h-12 gap-2 rounded-xl px-5 text-sm",
  icon: "size-10 rounded-lg",
} as const;

export type ButtonVariant = keyof typeof variantStyles;
export type ButtonSize = keyof typeof sizeStyles;

export function buttonStyles({
  className,
  size = "md",
  variant = "primary",
}: {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
} = {}) {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
    variantStyles[variant],
    sizeStyles[size],
    className,
  );
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
  loadingLabel?: React.ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      disabled,
      isLoading = false,
      loadingLabel,
      size = "md",
      type = "button",
      variant = "primary",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={buttonStyles({ className, size, variant })}
        disabled={disabled || isLoading}
        type={type}
        {...props}
      >
        {isLoading ? (
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
        ) : null}
        <span>{isLoading ? (loadingLabel ?? children) : children}</span>
      </button>
    );
  },
);
